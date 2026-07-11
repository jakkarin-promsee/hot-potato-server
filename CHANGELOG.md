# Changelog — Hot Potato Server

All notable changes to the API. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); dates are ISO. **Nothing is released/deployed yet** — the whole rework sits under `[Unreleased]` until the one-shot launch pass (see [`../ROADMAP.md`](../ROADMAP.md) Tier 5). Prompt-level tone changes have their own log: [`prompt-notes.md`](prompt-notes.md).

## [Unreleased]

### Added
- **Unified tutor endpoint** `POST /api/chat/tutor` — four modes (`free_chat`, `question_feedback`, `write_evaluation`, `followup`), SSE streaming with a JSON fallback, up to 3 suggestion chips, six student personality presets, per-lesson teacher `agent_settings`, and a `StudentMemory` digest for logged-in students.
- **Teacher AI copilot** `POST /api/creator/assist` — one endpoint, 11 authoring actions, teacher-only (`protect` + owner check), Gemini JSON mode with server-side validation of generated blocks.
- **Google Sign-In** `POST /auth/google` — verifies GIS ID tokens (`google-auth-library`), find-or-create with safe auto-link by verified email; `User.password` now optional for Google-only accounts.
- **Observability** — in-memory error ring buffer + AI-health snapshot surfaced (sanitized) on `GET /api/status/all`.
- **Profile** `GET/PUT /api/users/me/profile`; author-name renames propagate to denormalized lesson snapshots.
- **Server-owned lesson context** (`lessonContext.service`, cached) so clients never ship lesson text.
- Structured 401 contract, admin role + `npm run promote`, env-driven CORS allowlist, bot-only per-surface rate limiters, transient-error retry (`generateWithRetry`).

### Changed
- Migrated the AI SDK from `@google/generative-ai` to **`@google/genai`**.
- Model defaults centralized in `services/tutor/models.ts` (`gemini-2.5-flash-lite` fast / `gemini-2.5-flash` tutor — switched from `gemini-3.5-flash` on 2026-07-12 for output cost; flip back via `AI_TUTOR_MODEL=gemini-3.5-flash`).
- Split boot: `app.ts` exports the app, `index.ts` boots it (enables offline tests).

### Removed
- Legacy AI endpoints `/chat/ask`, `/chat/feedback`, `/chat/write-evaluate` and `chat.controller.ts` (replaced by the unified `/tutor`).

### Security
- bcrypt (cost 12) password hashing; JWT pinned to HS256; no student messages or secrets logged by default (`AI_DEBUG_PROMPTS` is dev-only). See [`../docs/security-model.md`](../docs/security-model.md).

---

_Older pre-rework history predates this changelog. When the first deploy happens, cut a `[1.0.0]` release from `[Unreleased]` with the date._
