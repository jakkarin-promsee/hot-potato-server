<!-- Server PR. See CONTRIBUTING.md for the full guide. -->

## What & why

<!-- One or two sentences. Link the roadmap phase / issue if any. -->

## Checklist

- [ ] `npm test` green (offline — in-memory Mongo + mocked Gemini); new tests cover this change
- [ ] `npm run build` (tsc) passes
- [ ] **Golden Rules intact** — no `protect` on AI/public-read routes; no per-student quotas
- [ ] Access checks in place for any new/changed endpoint (anon / non-owner / admin as applicable)
- [ ] Docs updated — route table in `CLAUDE.md`/`README.md`, `docs/data-model.md`, and `prompt-notes.md` if a prompt changed
- [ ] No secrets or student messages logged/committed

## Notes for the reviewer

<!-- Anything non-obvious, trade-offs, or follow-ups. -->
