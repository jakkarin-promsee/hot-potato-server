# types/ — shared server types

> Updated 2026-07-11 · local quick-reference.

## Files

| File | What it does |
| --- | --- |
| `index.ts` | `AuthRequest` — Express `Request` extended with `.user` (set by `protect`/`optionalAuth`). Every controller signature uses it: `(req: AuthRequest, res) => Promise<void>`. |

## Note
Model interfaces (`IUser`, `IContent`, …) live with their schemas in `models/*.model.ts`, not here. Promote a type here only when it's shared across unrelated modules.
