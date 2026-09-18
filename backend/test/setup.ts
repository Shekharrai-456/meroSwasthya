// Runs once per test file (vitest.config.ts setupFiles). Points the app at the
// TEST database so `npm test` never touches dev data, and requires the same
// required env vars as the app itself (config.ts) - if these are missing,
// tests fail loudly here rather than deep inside a confusing assertion.
// Vitest doesn't load .env files itself, unlike tsx/dotenv-aware runners.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
