import { Role } from '../../../generated/prisma/enums.js';
import { config } from '../../config.js';
import { addDuration } from '../../lib/dates.js';
import { AppError, ErrorCode } from '../../lib/errors.js';
import {
  DUMMY_PIN_HASH,
  generateRefreshToken,
  hashPin,
  hashRefreshToken,
  verifyPin,
} from '../../lib/hash.js';
import { prisma } from '../../lib/prisma.js';
import {
  checkFixedWindowLimit,
  checkPinLockout,
  clearPinLockout,
  recordPinFailure,
} from '../../lib/rateLimiter.js';
import { toUserDto, type UserDto, type UserWithFacility } from '../../lib/serializers.js';
import { signAccessToken, signTempToken } from '../../lib/tokens.js';
import type {
  OtpRequestInput,
  OtpVerifyInput,
  PinLoginInput,
  PinSetInput,
  ProviderActivateInput,
  RefreshInput,
} from './schemas.js';

// backend.md §7.1 step 1.
const OTP_EXPIRY_SEC = 300;
// REQ-AUTH-004: max verify attempts against one issued code.
const OTP_MAX_ATTEMPTS = 5;
// REQ-AUTH-002: 5 requests per phone per 10 min.
const OTP_REQUEST_LIMIT = 5;
const OTP_REQUEST_WINDOW_SEC = 600;
// REQ-SEC-001: 10 requests per IP+phone per 15 min (stacked with the separate
// per-account lockout in lib/rateLimiter.ts - docs/SECURITY.md row 2, Q6).
const PIN_LOGIN_RATE_LIMIT = 10;
const PIN_LOGIN_RATE_WINDOW_SEC = 900;

function generateOtpCode(): string {
  if (config.OTP_MODE === 'demo') {
    // REQ-AUTH-003. Gated on OTP_MODE, not SMS_MODE - see docs/PROGRESS.md's
    // Session 3 entry for why this reading was chosen over backend.md A.4's
    // literal (and internally inconsistent) "present only when SMS_MODE=mock"
    // line.
    return '123456';
  }
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

export interface OtpRequestResult {
  otpSentTo: string;
  expiresInSec: number;
  demoOtp?: string;
}

export async function requestOtp(input: OtpRequestInput): Promise<OtpRequestResult> {
  const limit = await checkFixedWindowLimit(
    `otp-request:${input.phone}`,
    OTP_REQUEST_LIMIT,
    OTP_REQUEST_WINDOW_SEC,
  );
  if (!limit.allowed) {
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      `Too many OTP requests, try again in ${limit.retryAfterSec}s`,
    );
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_SEC * 1000);

  await prisma.otpCode.upsert({
    where: { phone: input.phone },
    create: { phone: input.phone, code, expiresAt, attempts: 0 },
    update: { code, expiresAt, attempts: 0 },
  });

  const result: OtpRequestResult = { otpSentTo: input.phone, expiresInSec: OTP_EXPIRY_SEC };
  if (config.OTP_MODE === 'demo') {
    result.demoOtp = code;
  }
  return result;
}

export interface OtpVerifyResult {
  tempToken: string;
  hasPin: boolean;
  isNewUser: boolean;
}

function otpFieldError(message: string): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, message, [{ field: 'otp', message }]);
}

export async function verifyOtp(input: OtpVerifyInput): Promise<OtpVerifyResult> {
  const record = await prisma.otpCode.findUnique({ where: { phone: input.phone } });
  if (!record) {
    throw otpFieldError('Incorrect or expired code');
  }
  if (record.expiresAt.getTime() < Date.now()) {
    await prisma.otpCode.delete({ where: { phone: input.phone } });
    throw otpFieldError('Code expired, request a new one');
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    throw otpFieldError('Too many attempts, request a new code');
  }
  if (record.code !== input.otp) {
    await prisma.otpCode.update({
      where: { phone: input.phone },
      data: { attempts: { increment: 1 } },
    });
    throw otpFieldError('Incorrect code');
  }

  // Single-use: the code is consumed on a successful verify so it can never
  // be replayed even within its 5-minute window.
  await prisma.otpCode.delete({ where: { phone: input.phone } });

  const user = await prisma.user.findUnique({ where: { phone: input.phone } });
  const tempToken = await signTempToken(input.phone);
  return { tempToken, hasPin: user?.pinHash != null, isNewUser: user == null };
}

export interface AuthTokensResult {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
}

async function issueTokenPair(
  user: Pick<UserWithFacility, 'id' | 'role' | 'facilityId'>,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = await signAccessToken(user);
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = addDuration(new Date(), config.REFRESH_TOKEN_TTL);
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
  return { accessToken, refreshToken };
}

// REQ-AUTH-005. Also serves as the PIN-reset endpoint (OPEN_QUESTIONS Q2,
// resolved Option A): calling this again for an existing user with a fresh
// tempToken overwrites pinHash unconditionally - holding a just-verified OTP
// is the security boundary, not a separate reset mechanism.
export async function setPin(phone: string, input: PinSetInput): Promise<AuthTokensResult> {
  const pinHash = await hashPin(input.pin);

  const user = await prisma.user.upsert({
    where: { phone },
    create: { phone, pinHash, name: input.name, role: Role.patient },
    update: { pinHash, name: input.name },
    include: { facility: true },
  });

  const tokens = await issueTokenPair(user);
  return { ...tokens, user: toUserDto(user) };
}

// REQ-AUTH-006. Two independent, stacked controls (docs/SECURITY.md row 2,
// Q6): an IP+phone request-rate limiter (checked first, cheap) and a
// phone-only account lockout (checked second, survives an IP change).
export async function loginWithPin(
  input: PinLoginInput,
  callerIp: string,
): Promise<AuthTokensResult> {
  const rate = await checkFixedWindowLimit(
    `pin-login:${callerIp}:${input.phone}`,
    PIN_LOGIN_RATE_LIMIT,
    PIN_LOGIN_RATE_WINDOW_SEC,
  );
  if (!rate.allowed) {
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      `Too many login attempts, try again in ${rate.retryAfterSec}s`,
    );
  }

  const lockout = await checkPinLockout(input.phone);
  if (!lockout.allowed) {
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      `Account locked, try again in ${lockout.retryAfterSec}s`,
    );
  }

  const user = await prisma.user.findUnique({
    where: { phone: input.phone },
    include: { facility: true },
  });

  // Same error for "no such user" and "wrong PIN" - never let a caller
  // distinguish an unregistered phone from a registered one with a wrong PIN
  // (user-enumeration defense). Session 8 finding: the identical error
  // message alone didn't close this - a missing user/pinHash used to
  // short-circuit before ever calling verifyPin, so it returned in a
  // fraction of the time a real wrong-PIN attempt took (a real argon2id
  // verify). `verifyPin` now always runs, against the real hash or
  // `DUMMY_PIN_HASH`, so both branches pay the same cost before responding.
  const pinMatches = await verifyPin(user?.pinHash ?? DUMMY_PIN_HASH, input.pin);
  if (!user?.pinHash || !pinMatches) {
    await recordPinFailure(input.phone);
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid phone or PIN');
  }

  await clearPinLockout(input.phone);
  const tokens = await issueTokenPair(user);
  return { ...tokens, user: toUserDto(user) };
}

// REQ-AUTH-007, REQ-AUTH-011, docs/SECURITY.md row 5. Reuse of an
// already-rotated (revokedAt != null) refresh token is treated as theft: the
// entire family (every other still-active token for that user) is revoked,
// not just the one presented.
export async function rotateRefreshToken(
  input: RefreshInput,
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashRefreshToken(input.refreshToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!record) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid refresh token');
  }

  if (record.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid refresh token');
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid refresh token');
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid refresh token');
  }

  const newRefreshToken = generateRefreshToken();
  const newTokenHash = hashRefreshToken(newRefreshToken);
  const newExpiresAt = addDuration(new Date(), config.REFRESH_TOKEN_TTL);

  // Atomic: a concurrent second refresh using the same old token must see
  // either "not yet revoked" or "already revoked", never a state in between.
  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } }),
    prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: newTokenHash, expiresAt: newExpiresAt },
    }),
  ]);

  const accessToken = await signAccessToken(user);
  return { accessToken, refreshToken: newRefreshToken };
}

// REQ-AUTH-008, REQ-AUTH-013: invite codes may be reusable in the demo build,
// so usedByUserId is informational (last activator) rather than a single-use
// gate - reactivating with the same or a different code is always allowed.
export async function activateProvider(
  userId: string,
  input: ProviderActivateInput,
): Promise<UserDto> {
  const invite = await prisma.inviteCode.findUnique({ where: { code: input.inviteCode } });
  if (!invite) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Invite code not found');
  }

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { role: invite.role, facilityId: invite.facilityId },
      include: { facility: true },
    }),
    prisma.inviteCode.update({ where: { code: input.inviteCode }, data: { usedByUserId: userId } }),
  ]);

  // TypeScript can't see that the first transaction result is always
  // present, but Prisma's $transaction array form runs them in order.
  return toUserDto(updated as UserWithFacility);
}

export async function getMe(userId: string): Promise<UserDto> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { facility: true } });
  if (!user) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Account no longer exists');
  }
  return toUserDto(user);
}
