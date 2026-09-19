# Swasthya Card

Patient-owned, offline-first health record for rural Nepal, with a maternal-care
module. See `documentation/backend.md` and `documentation/frontend.md` for the
full product specification (Part A of each is the byte-identical shared API
contract between the two).

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | The Node/TypeScript/Fastify/Prisma backend - the only code in this repository. **Start here**: `backend/README.md` has the full setup, run, test, and deployment instructions. |
| `documentation/` | The frozen product specification (`backend.md`, `frontend.md`) this build is against. Read-only source material, not modified during the build. |
| `docs/` | This build's own working documents: requirement ledger, architecture, data model, API contract, security threat table, tech decisions, testing strategy, project plan, session-by-session progress log, and the final audit. Updated in the same commit as the code they describe. |
| `CLAUDE.md` | Operating rules this build follows (traceability, evidence, testing, and documentation requirements). |

There is no frontend code in this repository - `documentation/frontend.md`
describes a separate Flutter application built by a different developer
against the same shared API contract.

## Getting started

Everything you need to run, test, and develop the backend is in
[`backend/README.md`](backend/README.md).
