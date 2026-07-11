# controllers/ — request handling + business logic

> Updated 2026-07-11 · local quick-reference. Route table: [`../../CLAUDE.md`](../../CLAUDE.md) §"API surface". Request lifecycle: [`../../../docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) §2.

The **C** in MVC. Each is `(req: AuthRequest, res) => Promise<void>` — validate inputs **inline** (no schema lib), enforce access, respond, return early on error. Access control lives here, not in the schemas.

## Files

| File | Handles | Notes |
| --- | --- | --- |
| `auth.controller.ts` | register / login / google / recheck / change-password | `generateToken`; Google verifies GIS ID token then find-or-create |
| `content.controller.ts` | lesson CRUD + search | enforces `access_type`; **optimistic concurrency → 409**; `sanitizeAgentSettings`; drops client-sent author fields |
| `answer.controller.ts` | student answers (`UserContent`) | get / save one / bulk-save the answer map |
| `history.controller.ts` | recently visited lessons | `getHistory` / `recordVisit` (`touchLearningHistory`) |
| `category.controller.ts` | image-library folders | CRUD + `getImagesByCategory` (all owner-scoped) |
| `image.controller.ts` | Cloudinary image metadata | save / save-from-url / delete / clear / assign-category |
| `user.controller.ts` | profile + admin | `GET/PUT /me/profile` (rename propagates author snapshots); `GET /` lists users (admin) |
| `status.controller.ts` | health | server / database / env / aggregated `/all` (sanitized public + admin internals) |
| `tutor.controller.ts` | **the unified AI tutor** (`tutorChat`) | 4 modes, SSE/JSON, the `coerce*` input validators, history assembly — see [`../services/tutor/README.md`](../services/tutor/README.md) + [`../docs/ai-internals.md`](../docs/ai-internals.md) |
| `creator.controller.ts` | **the teacher copilot** (`assist`) | 11 actions, teacher-only (`protect` + owner check), JSON mode + validation |
| `memory.controller.ts` | student tutor-memory | `GET/DELETE /chat/memory` |

## Gotchas
- **Guard the AI right:** `tutor.controller` is `optionalAuth` (Golden Rule 2 — anonymous full access), `creator.controller` is `protect` + owner check. Never swap them.
- Owner/access checks are duplicated inline across `content`/`history`/`tutor` — a shared `checkContentAccess` is a pending refactor ([`../../../notes.md`](../../../notes.md)).
- Throw to reach `error.middleware`, or `res.status().json()` directly (most do the latter).
