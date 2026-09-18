# Open Questions — Session 0

Ordered by how much they block downstream design/implementation work. Answer inline (under each question) and Session 1 will read this file first.

> **Session 1 note:** no answers had actually been written into this file when Session 1 started — it was byte-identical to the Session 0 output. None of the six questions fall into CLAUDE.md §5's "must ask" bucket (no credentials, no irreversible action, no genuinely unresolvable conflict once a call is made), so per "decide vs. ask" each is resolved below using this document's own Session 0 RECOMMEND line, and design proceeds on that basis. **Flag these to the user for confirmation/override** — they are not silently assumed permanent.

---

QUESTION 1: Can `fchv` open the "add visit" screen at all, and if so, in what mode?
AFFECTS:    REQ-ROLE-005, REQ-VISIT-001, REQ-VISIT-011, REQ-SYNC-003
WHY:        backend.md blocks the role from `POST /patients/:id/visits` and from the sync `visits` table in three separate, consistent places (§7.3, §9.3, §9.7). frontend.md's screen S22 lists `fchv` among the screen's allowed roles as "read-only, cannot prescribe," which only makes sense if fchv can reach the screen and submit *something* — but the backend has no such reduced-write path for visits at all, only a hard 403.
OPTIONS:    A. Backend is authoritative: fchv never reaches the add-visit screen; the route is simply not shown/navigable for that role.
            B. fchv can open the screen read-only (view past visits only, no submit button at all).
            C. Add a genuinely reduced backend write path for fchv (e.g. observation-only "visit note" without diagnoses/prescriptions) — a real scope change beyond what's currently specified.
RECOMMEND:  A. It matches the backend rule stated three times and requires no new server behavior; treat the frontend's S22 wording as the documentation error to fix when Part A is next regenerated.
RESOLVED (Session 1, auto per RECOMMEND — pending user confirmation): Option A. fchv role is redirected away from `/provider/patient/:id/visit/new` entirely; the route guard treats fchv identically to "no visit access." Backend needs no new code path.

QUESTION 2: Does `POST /auth/pin/set` also serve as the "Forgot PIN" reset endpoint, or is a separate reset flow needed?
AFFECTS:    REQ-AUTH-005, REQ-AUTH-006
WHY:        frontend.md S04 has a "Forgot PIN → re-verify OTP" link that must land somewhere, but backend.md §7.1 describes `pin/set` as creating a user "if missing" and setting the PIN — it never states whether calling it again for an existing user (after a fresh OTP verify) overwrites the old `pinHash`.
OPTIONS:    A. Reuse `pin/set`: allow it to overwrite `pinHash` for an existing user too, gated only by holding a valid `tempToken` (i.e. having just passed OTP verification is proof enough).
            B. Add a distinct `POST /auth/pin/reset` endpoint with the same tempToken gate, to keep "create" and "reset" semantically separate and separately auditable/rate-limited.
RECOMMEND:  A. Simpler, and a fresh OTP verification is already the security boundary the rest of the auth flow relies on; document the overwrite behavior explicitly when this is decided.
RESOLVED (Session 1, auto per RECOMMEND — pending user confirmation): Option A. `POST /auth/pin/set` overwrites an existing user's `pinHash` when called with a fresh `tempToken`; this is documented explicitly in API_CONTRACT.md and covered by an auth test (existing user + valid tempToken → PIN changes; old PIN then rejected).

QUESTION 3: Should PNG uploads be supported end-to-end, or dropped from the accepted content types?
AFFECTS:    REQ-DOC-001, REQ-DOC-002
WHY:        `POST /documents/presign` accepts `image/png` per its stated contentType allowlist, but the object key it generates is hard-coded to a `.jpg` extension (`{documentId}.jpg`), which would mismatch a PNG's actual bytes/extension on both storage and any later consumer that infers type from the key.
OPTIONS:    A. Drop PNG from the accepted list; camera capture always produces JPEG anyway (frontend.md §3 uses `flutter_image_compress`, which the app already targets at JPEG quality 80).
            B. Keep PNG accepted and generate the object key extension from the actual `contentType` (`.jpg` or `.png`).
RECOMMEND:  A. The frontend's only documented capture path already compresses to JPEG; simplest fix with no behavior change needed anywhere else.
RESOLVED (Session 1, auto per RECOMMEND — pending user confirmation): Option A. `POST /documents/presign` accepts only `image/jpeg`; `image/png` is dropped from the allowlist and the object key stays `{documentId}.jpg`. Documented as a deliberate deviation from backend.md §9.4's literal text in TECH_DECISIONS.md / API_CONTRACT.md.

QUESTION 4: Is any soft-delete / archive feature actually in scope for the hackathon build?
AFFECTS:    REQ-PATIENT-012, GAPS G3/G5
WHY:        Every syncable entity has a `deleted` flag and the sync-pull protocol explicitly returns `deleted=true` rows, but no endpoint anywhere in Part A.4 or the module specs (§9.1–§9.5) ever sets that flag. Building the filtering logic without a trigger for it is wasted scope; not building it risks missing a requirement that was simply left undocumented.
OPTIONS:    A. Out of scope for the 32-hour build: keep the `deleted` column (for future-proofing / schema stability with the sync protocol) but never write to it; query filters (`WHERE deleted = false`) are still worth keeping since the sync client already expects the field.
            B. In scope: add a minimal delete/archive action (e.g., "remove family member" on S07) that the docs simply forgot to specify.
RECOMMEND:  A. Nothing in either document's screens or 32-hour plan references a delete action; treat it as forward-compatible schema, not a missing feature.
RESOLVED (Session 1, auto per RECOMMEND — pending user confirmation): Option A. `deleted` columns and read-path filters (`WHERE deleted = false`) are built (needed for the sync-pull contract regardless), but no delete/archive endpoint or UI action is built. Revisit if the user says otherwise.

QUESTION 5: Should the `anc_missed` reminder's documented "repeat once after 7 days" behavior be implemented?
AFFECTS:    REQ-PREG-007, GAPS G2
WHY:        `RULES.reminders.anc_missed` (A.5) documents a 7-day repeat that no module spec (§9.5 creation logic, §9.6 worker) actually implements — only a single `anc_missed` reminder is ever created per contact.
OPTIONS:    A. Implement the repeat in Session 5 (cross-cutting reminders work) as originally specified in the rules text.
            B. Treat it as an aspirational rule-table description beyond the 32-hour Tier 1 scope; ship the single reminder only, and update `RULES.reminders.anc_missed`'s wording later to match reality.
RECOMMEND:  B for the hackathon timeline (backend.md §13 gives reminders only a 2-hour slot at hour 22-24), with a note to implement A if there's time in Session 5.
RESOLVED (Session 1, auto per RECOMMEND — pending user confirmation): Option B for Tier 1. REQ-PREG-007's scope is fixed at "single anc_missed reminder per contact"; the 7-day repeat is logged as a Tier-2 stretch item in PROJECT_PLAN.md, not a NOT_STARTED Tier-1 row.

QUESTION 6: Are the two documented PIN-login rate limits ("10/15min/IP+phone" and "5 wrong PINs → 15 min lock") meant to be the same control or two independent, stacked mechanisms?
AFFECTS:    REQ-AUTH-006, REQ-SEC-001
WHY:        backend.md §11 and §7.1 step 4 describe what reads like two different thresholds for what may be the same protection (brute-force lockout on PIN login), without reconciling them.
OPTIONS:    A. Treat as two independent, stacked controls: an IP+phone request-rate limiter (10/15min, protects against distributed guessing) plus a separate per-account failure counter (5 wrong → 15 min lock, protects a specific account even from a single IP).
            B. Treat as one mechanism, and pick a single threshold (resolve the discrepancy by using the stricter of the two numbers).
RECOMMEND:  A. Defense-in-depth stacking is a reasonable and common pattern and requires no doc correction — just implement both as literally described.
RESOLVED (Session 1, auto per RECOMMEND — pending user confirmation): Option A. Both controls are implemented: a `@fastify/rate-limit` route-level limiter (10 requests/15 min, keyed on IP+phone) in front of `/auth/pin/login`, plus a separate Redis-backed per-account failure counter (5 wrong PINs → 15 min account lock, independent of caller IP). See SECURITY.md.
