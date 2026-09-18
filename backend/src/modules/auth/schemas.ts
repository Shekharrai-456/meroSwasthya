import { z } from 'zod';

// REQ-AUTH-001: E.164, e.g. "+9779801000001". Backend validates shape only;
// the app does the human-friendly +977 prefix UI (frontend.md S02, OUT-OF-REPO).
const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format, e.g. +9779801000001');

const pinSchema = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits');

const otpSchema = z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits');

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  otp: otpSchema,
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const pinSetSchema = z.object({
  pin: pinSchema,
  name: z.string().trim().min(1, 'Name is required').max(200),
});
export type PinSetInput = z.infer<typeof pinSetSchema>;

export const pinLoginSchema = z.object({
  phone: phoneSchema,
  pin: pinSchema,
});
export type PinLoginInput = z.infer<typeof pinLoginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const providerActivateSchema = z.object({
  inviteCode: z.string().trim().min(1, 'inviteCode is required'),
});
export type ProviderActivateInput = z.infer<typeof providerActivateSchema>;
