# Contributing — Hot Potato Server

Thanks for working on the API. This is the server half; the client is a **separate git repository** (`hot-potato-client`). Read [`CLAUDE.md`](CLAUDE.md) for the full architecture and the rules you must not break.

> New here? Start with [`../docs/onboarding.md`](../docs/onboarding.md) (get it running) and [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) (the mental model).

## Ground rules

1. **Obey the two Golden Rules.** (1) Never ration tokens for real students; (2) anonymous users keep full access. Never add `protect` to an AI or public-read route — use `optionalAuth`. See [`../docs/security-model.md`](../docs/security-model.md).
2. **Tests green before done.** `npm test` (offline — in-memory Mongo + mocked Gemini) must pass. Every change ships tests for its own behavior. See [`../docs/testing.md`](../docs/testing.md).
3. **Update the docs you invalidate.** Change a mechanism → update `CLAUDE.md` (and the relevant `docs/` flow/ADR). Change a prompt → append to [`prompt-notes.md`](prompt-notes.md).
4. **Git reality.** Run git **inside `server/`**, never from the workspace root (a stray home-dir repo surfaces unrelated files). Don't push/deploy unless asked — deploy is one owner-gated pass (ADR-015).

## Code style (match the existing files)

- **TypeScript, CommonJS modules.** Controllers are `(req: AuthRequest, res: Response) => Promise<void>`.
- **Validation is manual and inline** — no schema library. Guard every input (`typeof x === "string"`, length caps), respond, and `return` early on error. Copy the style in `tutor.controller.ts`.
- **Errors:** either `throw` (reaches `error.middleware.ts`, which must stay mounted last) or `res.status(...).json(...)` directly — most code does the latter.
- **Access control lives in controllers** (owner/collaborator checks), not schemas.
- **Never log secrets or student messages.** `AI_DEBUG_PROMPTS` is dev-only.

## Recipe: add a REST endpoint

1. **Route** — add to the right `routes/*.routes.ts` (or a new group mounted in `app.ts`, *before* the error handler). Choose the guard chain:
   - public read that's richer when logged in → `optionalAuth`
   - per-user / owner action → `protect` (+ inline owner check in the controller)
   - admin-only → `protect, restrictTo("admin")`
   - AI-ish → also add `...createChatRateLimiter()` (its own bucket).
2. **Controller** — `controllers/*.controller.ts`: validate inputs inline, do the work, respond. Access checks here.
3. **Model** — if new data, add/extend `models/*.model.ts` (the data contract; add indexes intentionally). Update [`../docs/data-model.md`](../docs/data-model.md).
4. **Test** — `test/api/*.test.ts` via Supertest: each guard state (anon → 401/anon-ok, non-owner → 403, owner → happy) + bad input. Mocked Gemini, in-memory DB.
5. **Document** — add the row to the route table in [`CLAUDE.md`](CLAUDE.md) and [`README.md`](README.md).

## Recipe: add a teacher-copilot action

`POST /api/creator/assist` is one endpoint with N actions. To add one: add a `build<Action>Prompt` in `services/creator/prompts.ts` (Thai-first, include the loanword rule; JSON actions embed the schema + "answer JSON only" and use Gemini JSON mode), extend `services/creator/parse.ts`/`validate.ts` (drop malformed items — **never return raw TipTap JSON**), wire the action in `creator.controller.ts` with model routing (`getFastModel`/`getTutorModel`), and add api tests. The client side goes through `lib/creatorApi.ts` with a preview→accept dialog. See [`docs/ai-internals.md`](docs/ai-internals.md) and [`../docs/ideas.md`](../docs/ideas.md) ADR-009.

## Recipe: change a tutor prompt (the dangerous one)

The tone is **owner-gated**. Edit `services/tutor/persona.ts` → update the snapshot tests (`test/unit/persona.test.ts`) → **append a row to [`prompt-notes.md`](prompt-notes.md)** (date / what felt off / fix) → have the owner sign off tone. New internal bracket tag? Add its prefix to `INTERNAL_TAG_PREFIXES`. Inspect the built prompt with `AI_DEBUG_PROMPTS=true` (dev only); measure size with `scripts/measure-context.ts`. See [`docs/ai-internals.md`](docs/ai-internals.md).

## Recipe: add an env var

Read it where used (defensively, with a default); document it in the [`CLAUDE.md`](CLAUDE.md) + [`README.md`](README.md) env tables **and its unset behavior** (e.g. fail-open, disabled). If it affects the AI, update [`../asking-flow.md`](../asking-flow.md). If it must be set in production, add it to the launch checklist in [`../docs/operations.md`](../docs/operations.md).

## Pull request checklist

- [ ] `npm test` green; new tests cover the change
- [ ] `npm run build` (tsc) passes
- [ ] Golden Rules intact (no `protect` on AI/public-read; no student quotas)
- [ ] Docs updated (route table / data-model / prompt-notes as applicable)
- [ ] No secrets or student data logged/committed
