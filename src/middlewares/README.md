# middlewares/ — Express middleware

> Updated 2026-07-11 · local quick-reference. Security model: [`../../../docs/security-model.md`](../../../docs/security-model.md).

## Files

| File | Exports · what it does |
| --- | --- |
| `auth.middleware.ts` | `protect` (JWT HS256, active-user-only, else **structured 401** `{forceRelogin,clearToken,code}`), `optionalAuth` (sets `req.user` if valid, else silently anonymous — never errors), `restrictTo(...roles)` (403 gate, use after `protect`) |
| `rateLimit.middleware.ts` | `createChatRateLimiter()` (bot-only; keyed by user id or IP; 10-min + daily windows) and `createAuthRateLimiter()` (per-IP, login/register). **Factories** → fresh buckets per surface |
| `error.middleware.ts` | `errorHandler` — the central handler, **mounted last** in `app.ts`; also where the observability ring buffer hooks in |

## Gotchas
- **`optionalAuth`, not `protect`, on AI + public-read routes** (Golden Rule 2). The structured-401 body is a contract with `client/src/lib/axios.ts` — change both sides together (ADR-011).
- Rate limits are **bot-only and per-surface** (Golden Rule 1) — never add per-student quotas; the creator route gets its own bucket so teacher AI never eats the student budget.
- `errorHandler` **must stay last** in `app.ts` (ADR-006/017).
