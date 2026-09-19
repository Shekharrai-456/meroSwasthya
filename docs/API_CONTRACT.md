# API Contract — Swasthya Card

This document is the **conventions** layer; per-endpoint request/response detail lives in the generated `docs/openapi.json` once Session 2 stands up the server. Every convention below is already fixed by `backend.md`/`frontend.md` Part A (shared, byte-identical contract) — this document doesn't invent new conventions, it states which existing ones are binding and resolves the two open questions that touch the contract.

## 1. Versioning

- Base path: `/api/v1`. A breaking change to any shape below requires a new version prefix, never a silent edit to `v1` (CLAUDE.md §8).
- The mobile app's base URL is runtime-configurable (Settings screen, frontend.md §5) specifically so the tunnel/host can change without a rebuild — this has no bearing on the `/api/v1` path itself.

## 2. Auth header and token lifetimes

| Token | Header / delivery | Lifetime | Claims |
|---|---|---|---|
| Access token | `Authorization: Bearer <jwt>` | 12 h | `{sub, role, fid, typ:"access", iat, exp}`, HS256/`JWT_SECRET` |
| Temp token (OTP→PIN bridge) | `Authorization: Bearer <jwt>` | 10 min | `{sub, typ:"temp", iat, exp}` |
| Refresh token | request body field | 30 d | opaque 32 bytes, stored hashed server-side |
| Grant token (QR) | embedded in `qrPayload`, not a header | 10 min default (`ttlMinutes`), 1 year for the printed card | `{typ:"grant", gid, pid, scope, iat, exp}`, HS256/`GRANT_SECRET` |

Endpoints marked "Auth: none" need no header. Grant tokens are never accepted where an access token is expected and vice versa (REQ-GRANT-008/REQ-ROLE-008) — the auth plugin checks `typ` before anything else.

**Frontend integration note, found while writing the Phase 10 smoke test (`test/smoke.test.ts`):** `role`/`fid` are baked into the access token's JWT claims at issue time and never re-checked against the database on later requests (`requireAuth` trusts the token, doesn't re-fetch the user) — this is correct, deliberate stateless-JWT behaviour, not a bug, but it has a real consequence: **an access token obtained *before* `POST /auth/provider/activate` still carries the old role after activation succeeds.** The client must call `POST /auth/refresh` (which does re-fetch the user's current role from the database) immediately after a successful activation to get a token that actually unlocks provider/fchv-only endpoints — otherwise every following request 403s despite the activation response itself showing the new role. Confirmed by the smoke test failing at exactly this step before the refresh call was added.

**Question 2 resolution (PIN reset):** `POST /auth/pin/set` accepts a `tempToken` regardless of whether the user already has a `pinHash`; if one exists, it is overwritten. This makes `pin/set` do double duty as both "first PIN" and "forgot PIN reset," gated purely by holding a fresh `tempToken` (i.e. a fresh OTP verification) — no separate `/auth/pin/reset` endpoint is added.

## 3. Success and error envelopes

```json
// success — data is always an object, never a bare array
{ "ok": true, "data": { "...": "..." } }

// error
{ "ok": false, "error": { "code": "VERSION_CONFLICT", "message": "...", "details": { "...": "..." }, "request_id": "01J..." } }
```

`request_id` is the same id pino attaches to every log line for that request, so a client-reported error can be grepped directly in server logs (`docs/ARCHITECTURE.md` §6).

## 4. Error code table (binding — matches `backend.md` A.3 exactly, with one addition)

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | zod schema failure; `details = {field: message}` |
| 401 | `UNAUTHENTICATED` | missing/expired/invalid access token |
| 403 | `FORBIDDEN` | role not allowed, or no active grant |
| 403 | `GRANT_EXPIRED` | QR token expired (10 min) or access window ended (24 h) |
| 404 | `NOT_FOUND` | entity missing or soft-deleted |
| 409 | `VERSION_CONFLICT` | sync push / PATCH: `baseVersion`/`version` mismatch; `details.current` = the current entity |
| 409 | `ALREADY_REDEEMED` | grant token already redeemed by a different user |
| 422 | `RULE_VIOLATION` | e.g. pregnancy for a male patient, contact number outside 1..8, delivery on a non-active pregnancy, second active pregnancy |
| 429 | `RATE_LIMITED` | OTP request, grant creation, **or PIN-login lockout** too frequent |
| 500 | `INTERNAL` | unexpected; generic message only, full detail server-side only |

**Addition over `backend.md` A.3 (closes GAP G1):** the original error table's `429 RATE_LIMITED` row only mentioned "OTP or grant creation too frequent." The PIN-login account lockout (Question 6) also returns `429 RATE_LIMITED`, using the same code — no new code was introduced, the table's description is just widened to say so explicitly, so the frontend's error-mapping table (frontend.md §8) doesn't need a new branch.

## 5. Validation-error shape

Field-level, directly mappable onto form fields: `details: [{ "field": "email", "message": "already registered" }]` (per CLAUDE.md §8's example) — reconciled with `backend.md`'s literal `{field: message}` object shape by using an array of `{field, message}` pairs, which supports multiple errors on the same field (e.g. two failed checks on one date) without key collision. This is the one place this document's convention is more specific than `backend.md`'s prose; it does not change any endpoint's success behaviour.

## 6. List envelope and pagination

**Cursor-based, never offset/page-number** (`backend.md` A.1: "Pagination: cursor style... never page numbers"). Two cursor idioms are both already in use in the source spec, and both are kept because they serve different query shapes:

- **Timeline / list-with-`before`:** `{ "items": [...], "nextBefore": "<ISO timestamp>" }` — REQ-PATIENT-008.
- **Sync pull:** `{ "changes": [...], "cursor": "<ISO timestamp>", "hasMore": true }` — REQ-SYNC-009.

A generic collection envelope (`GET /patients`, `GET /codelists`, etc.) that doesn't paginate at all returns `{ "items": [...] }` with no cursor field, since the requirements never call for pagination on those (family lists and code lists are both small, bounded sets per patient/deployment). No offset/limit/page-number parameter is introduced anywhere.

## 7. Filter / sort / search grammar

The requirements do not call for a generic filter/sort/search query grammar anywhere in Part A — every list endpoint's ordering is fixed by the business logic itself (newest-first for visits/timeline, `updatedAt asc` for sync, distance-sorted for facilities), and the only filter parameter that exists (`GET /codelists?kind=`, `GET /facilities/nearby?birthing=`) is endpoint-specific, not a shared grammar. Per CLAUDE.md §2 ("every layer must have a stated reason"), a generic query-parameter grammar is **not introduced** — there is no requirement it would serve.

## 8. Status code policy

- `2xx`: `200` for every success response in this contract (no endpoint returns `201`, matching the "same id twice → 200 with existing" idempotency rule that spans creates — REQ-PATIENT-001, REQ-VISIT-002 — a `201` on first create and `200` on repeat would break that uniformity for no benefit).
- `4xx`/`5xx`: exactly the table in §4, chosen once by `AppError.httpStatus`, never by ad hoc `reply.code(...)` calls in a route.

## 9. Idempotency policy

- **Client-generated ids** (`Patient`, `Visit`, `Document`, `Pregnancy`, `AncContact`, `Delivery`) make every create endpoint naturally idempotent: posting the same `id` twice returns the existing row, 200, never a duplicate or a conflict (REQ-PATIENT-001, A.1).
- **Sync push** additionally de-duplicates by `opId` via the `SyncOp` table (REQ-SYNC-002) — this covers the case where the *op* is retried (e.g. after a dropped response) even though the underlying entity id is the same, distinguishing "I already applied this exact operation" from "this entity already exists via a different operation."
- No endpoint accepts a client-supplied `Idempotency-Key` header — it isn't needed on top of client-generated ids, and adding one would be a second idempotency mechanism with no distinct requirement behind it.

## 10. Rate-limit headers

`@fastify/rate-limit`'s default `x-ratelimit-limit` / `x-ratelimit-remaining` / `x-ratelimit-reset` response headers are enabled on every rate-limited route (OTP request, PIN login, grant creation — REQ-SEC-001) so the client can show "try again in N minutes" (frontend.md S02) without parsing the error body.

## 11. Upload flow

Two-step presigned flow, unchanged from `backend.md` §9.4 except for Question 3's resolution:

1. `POST /documents/presign` — body includes `contentType`; **only `image/jpeg` is accepted** (Question 3, Option A — PNG dropped since the only documented capture path, `flutter_image_compress`, always produces JPEG). Returns a 15-minute presigned PUT URL and headers.
2. Client `PUT`s the raw bytes directly to storage.
3. `POST /documents/:id/complete` — server does a `HEAD` on the object to confirm the upload landed, flips `status → uploaded`, returns a 1-hour presigned GET URL.

## 12. Endpoint table

Cross-checked against every screen in `frontend.md` §Screens (S01–S23) and the mock-API list (§15). Auth column: `none` / `temp` (tempToken) / `access` (access token). Role column: which roles may call it (`any` = all authenticated roles).

| Method & path | Auth | Role | REQ |
|---|---|---|---|
| `POST /auth/otp/request` | none | — | REQ-AUTH-002 |
| `POST /auth/otp/verify` | none | — | REQ-AUTH-004 |
| `POST /auth/pin/set` | temp | — | REQ-AUTH-005 |
| `POST /auth/pin/login` | none | — | REQ-AUTH-006 |
| `POST /auth/refresh` | none (body-carried refresh token) | — | REQ-AUTH-007 |
| `POST /auth/provider/activate` | access | patient | REQ-AUTH-008 |
| `GET /me` | access | any | REQ-AUTH-009 |
| `GET /patients` | access | any | REQ-ROLE-007 |
| `POST /patients` | access | any | REQ-PATIENT-001 |
| `GET /patients/:id` | access | canRead | REQ-PATIENT-004 |
| `PATCH /patients/:id` | access | owner | REQ-PATIENT-003 |
| `GET /patients/:id/timeline` | access | canRead | REQ-PATIENT-008 |
| `GET /patients/:id/audit` | access | owner | REQ-PATIENT-010 |
| `GET /patients/:id/visits` | access | canRead | REQ-VISIT-007 |
| `POST /patients/:id/visits` | access | canAppend, ≠fchv | REQ-VISIT-001 |
| `GET /patients/:id/reminders` | access | canRead | REQ-REMIND-005 |
| `POST /patients/:id/pregnancies` | access | canAppend | REQ-PREG-001 |
| `POST /grants` | access | owner | REQ-GRANT-001 |
| `POST /grants/redeem` | access | provider, fchv | REQ-GRANT-003 |
| `POST /grants/:id/revoke` | access | owner | REQ-GRANT-008 |
| `POST /documents/presign` | access | canAppend | REQ-DOC-001 |
| `POST /documents/:id/complete` | access | canAppend | REQ-DOC-004 |
| `GET /documents/:id` | access | canRead | REQ-DOC-005 |
| `POST /documents/:id/summarize` | access | canRead | REQ-DOC-006 |
| `GET /pregnancies/:id` | access | canRead | REQ-PREG-008 |
| `PATCH /pregnancies/:id` | access | canAppend | REQ-PREG-009 |
| `PUT /pregnancies/:id/contacts/:contactNo` | access | canAppend | REQ-PREG-010 |
| `POST /pregnancies/:id/delivery` | access | canAppend | REQ-PREG-015 |
| `POST /sync/push` | access | any | REQ-SYNC-001 |
| `GET /sync/pull` | access | any | REQ-SYNC-009 |
| `GET /facilities/nearby` | access | any | REQ-FACILITY-001 |
| `GET /codelists` | none | — | REQ-CODELIST-001 |
| `GET /rules` | none | — | REQ-META-001 |
| `GET /config` | none | — | REQ-META-002 |
| `GET /demo/sms` | none | — (mock mode only, else 404) | REQ-REMIND-006 |
| `GET /demo/sms.html` | none | — (mock mode only, else 404) | REQ-REMIND-006 |
| `POST /demo/reminders/fire` | none | — (mock mode only) | REQ-REMIND-007 |

37 endpoints total (34 Tier 1 + 3 demo-support). All are already implied by the frontend's Part A contract and screens — none were invented for this document.

### Cross-check against frontend.md

- **Endpoints the frontend implies that are missing from the above:** none found. Every screen's listed API calls (S01–S23) map onto a row in this table.
- **Endpoints in this table with no frontend consumer:** none — every row above is called from at least one screen or from the sync engine, except the three `/demo/*` routes, which exist for the projector/demo path (`backend.md` §9.6/§9.8) rather than the app itself; that is their documented purpose, not an orphaned endpoint.
- **Not included** (Tier 2/3, out of REQ ledger's Tier-1 scope per `docs/REQUIREMENTS.md` AS4): printed-QR redeem-with-PIN variant (REQ-GRANT-012), admin stats endpoint, DHIS2/HMIS export, NID verification, FCM push. These remain documented in `docs/REQUIREMENTS.md` but have no row here; they get one only if promoted into scope.
