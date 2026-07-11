# routes/ — URL → controller wiring

> Updated 2026-07-11 · local quick-reference. Full route table with methods + guards: [`../../CLAUDE.md`](../../CLAUDE.md) §"API surface".

Thin files: map a base path to controller functions and apply the guard chain. Mounted in `app.ts` (in this order); the error handler is mounted last.

## Files

| File | Mount | Guards (typical) |
| --- | --- | --- |
| `auth.routes.ts` | `/api/auth` | open + auth rate limit |
| `user.routes.ts` | `/api/users` | `protect` (+ `restrictTo("admin")` on list) |
| `content.routes.ts` | `/api/content` | `optionalAuth` reads · `protect` writes |
| `answer.routes.ts` | `/api/content-answer` | `protect` |
| `history.routes.ts` | `/api/history` | `protect` |
| `category.routes.ts` | `/api/categories` | `protect` |
| `image.routes.ts` | `/api/images` | `protect` |
| `chat.routes.ts` | `/api/chat` | `optionalAuth` + chat rate limit (`/tutor`) · `protect` (`/memory`) |
| `creator.routes.ts` | `/api/creator` | `protect` + owner check + own rate-limit bucket |
| `status.routes.ts` | `/api/status` | open (sanitized) · `admin` (internals) |

## Gotcha
- The guard chain here **is** the security posture — pick it deliberately (open / `optionalAuth` / `protect` / `+restrictTo`). Never put `protect` on `/chat/tutor` or public content reads (Golden Rule 2). See [`../../../docs/security-model.md`](../../../docs/security-model.md).
