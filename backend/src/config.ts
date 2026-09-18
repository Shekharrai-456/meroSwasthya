import 'dotenv/config';
import { z } from 'zod';

// Pre-existing gap found in Session 3: nothing under src/ loaded .env before
// this - only test/setup.ts did, for vitest. `npm run dev`/`npm start` would
// have failed at startup with "Invalid environment configuration" the first
// time either was actually run outside a test process. dotenv.config() is a
// no-op for any var already set in the real environment (e.g. by Docker/CI),
// so this is safe everywhere config.ts is imported, including from tests.

// Every key here must also appear in .env.example (CLAUDE.md §7). Parsed once at
// startup; a missing/malformed required key fails loudly instead of leaving a
// silently-undefined value floating around the codebase.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url(),

  REDIS_URL: z.url(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  GRANT_SECRET: z.string().min(32, 'GRANT_SECRET must be at least 32 characters'),

  ACCESS_TOKEN_TTL: z.string().default('12h'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  GRANT_TTL_MIN_DEFAULT: z.coerce.number().int().positive().default(10),
  GRANT_ACCESS_WINDOW_H: z.coerce.number().int().positive().default(24),

  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),

  SMS_MODE: z.enum(['mock', 'sparrow']).default('mock'),
  SPARROW_TOKEN: z.string().optional(),
  SPARROW_FROM: z.string().optional(),

  // REQ-SEC-005: argon2id cost parameters, configurable rather than
  // hard-coded (CLAUDE.md §7). Defaults match docs/TECH_DECISIONS.md's
  // researched argon2id baseline.
  ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(4),

  OTP_MODE: z.enum(['demo', 'real']).default('demo'),
  AI_MODE: z.enum(['off', 'on']).default('off'),
  ANTHROPIC_API_KEY: z.string().optional(),

  TZ_DISPLAY: z.string().default('Asia/Kathmandu'),
  CORS_ORIGINS: z.string().default('*'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  corsOrigins: string[] | true;
};

export type ConfigParseResult =
  | { success: true; config: AppConfig }
  | { success: false; issues: string[] };

// Pure, side-effect-free validation - the actual shape tested in
// test/foundation.test.ts's "config validation failure" case. Kept separate
// from loadConfig()'s process.exit so a bad env can be asserted on without
// killing the test process.
export function parseConfig(env: NodeJS.ProcessEnv): ConfigParseResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }

  const value = parsed.data;
  return {
    success: true,
    config: {
      ...value,
      isProduction: value.NODE_ENV === 'production',
      corsOrigins:
        value.CORS_ORIGINS === '*' ? true : value.CORS_ORIGINS.split(',').map((o) => o.trim()),
    },
  };
}

function loadConfig(): AppConfig {
  const result = parseConfig(process.env);
  if (!result.success) {
    // Fail loudly and immediately — never let the app boot on an invalid config
    // (CLAUDE.md §7 "Configuration"). Logged via console here deliberately:
    // this runs before the pino logger exists.
    // biome-ignore lint/suspicious/noConsole: pre-logger startup failure path
    console.error(
      `Invalid environment configuration:\n${result.issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    process.exit(1);
  }
  return result.config;
}

export const config = loadConfig();
