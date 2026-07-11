# config/ — app configuration

> Updated 2026-07-11 · local quick-reference.

## Files

| File | What it does |
| --- | --- |
| `db.ts` | Mongoose connection (`connectDB`) using `MONGO_URI`. Retries, then `process.exit(1)` on exhaustion (boot fails loudly). Logs the Mongo host to server logs only. |

## Gotcha
- `connectDB` lives here but is **called from `index.ts`**, not `app.ts` (the app/entry split keeps `app.ts` importable by tests without a DB — ADR-017). Because `connectDB` exits on failure, `index.ts`'s `.catch()` is effectively unreachable ([`../../../notes.md`](../../../notes.md)).
