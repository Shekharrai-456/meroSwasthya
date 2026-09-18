import { createHash, randomBytes } from 'node:crypto';
import argon2, { type HashOptions } from 'argon2';
import { config } from '../config.js';

// REQ-SEC-005: PIN hashed with argon2id, cost parameters configurable
// (docs/TECH_DECISIONS.md defaults: memory=65536 KiB, time=3, parallelism=4).
const argon2Options: HashOptions = {
  type: argon2.argon2id,
  memoryCost: config.ARGON2_MEMORY_KIB,
  timeCost: config.ARGON2_TIME_COST,
  parallelism: config.ARGON2_PARALLELISM,
};

export function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, argon2Options);
}

export function verifyPin(hash: string, pin: string): Promise<boolean> {
  return argon2.verify(hash, pin);
}

// Refresh tokens are opaque, high-entropy (256-bit) random bearer values, not
// low-entropy secrets like a PIN - so unlike the PIN, they are hashed with a
// fast, deterministic SHA-256 rather than argon2id. This is a deliberate
// deviation from docs/REQUIREMENTS.md REQ-SEC-005's literal "argon2 hash"
// wording: docs/DATA_MODEL.md's own RefreshToken.tokenHash is specified as
// "unique - the lookup key on /auth/refresh", which requires exact-match
// lookup by equality. argon2's per-call random salt makes that structurally
// impossible (it can only be verified against one candidate at a time, never
// looked up by a WHERE tokenHash = ? unique index) - the two source
// requirements conflict, and slow/memory-hard hashing buys no real security
// margin against brute-forcing an already-unguessable 256-bit random value.
// Flagged explicitly in docs/PROGRESS.md's Session 3 entry, not silently
// resolved.
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
