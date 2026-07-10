# CLAUDE.md — Hot Potato Server

The REST API for Hot Potato: auth, content storage, student progress, image library, and the Google Gemini AI integration. Read the root [`../CLAUDE.md`](../CLAUDE.md) first for cross-cutting context (git layout, the two halves, conventions).

## Stack

- **Runtime:** Node.js, **TypeScript**, `commonjs` modules.
- **Framework:** Express 5.
- **Database:** MongoDB via **Mongoose 9**.
- **Auth:** `jsonwebtoken` (JWT) + `bcryptjs` (password hashing).
- **AI:** `@google/genai` → Gemini (migrated from deprecated `@google/generative-ai` in Phase 0).
- **Dev:** `nodemon` + `ts-node` (see `nodemon.json`).
- **Deploy:** Render (free tier — see *Gotchas*).

## Commands

```bash
npm install
npm run dev      # nodemon → ts-node src/index.ts   (auto-restart on change)
npm run build    # tsc → dist/
npm start        # node dist/index.js   (production; run build first)
```

```bash
npm test         # vitest run — unit + integration; offline (in-memory Mongo, Gemini mocked)
npm run test:watch
npm run test:ai  # live Gemini smoke; reads GEMINI_API_KEY from .env (vitest.ai.config sets RUN_AI_TESTS)
```

**Tests:** Vitest + supertest + `mongodb-memory-server` in `test/`. `npm test` runs fully **offline** (no network, no real DB, no API key). `npm run test:ai` costs real tokens — run at phase boundaries only; loads `.env` in `test/setup.ts`. The live smoke (`test/ai/live.ai.test.ts`) exercises all four `/chat/tutor` modes.

**Layout:**

```
server/test/
├── setup.ts              # in-memory Mongo + test env vars
├── fixtures/lesson.json  # committed lesson fixture (re-export from real DB via scripts/export-fixture.ts)
├── helpers/seed.ts
├── unit/                 # prompt builders, retry logic, lessonContext serializer
├── api/                  # auth, content, answers, tutor, memory, rateLimit (supertest)
└── ai/                   # live Gemini smoke (*.ai.test.ts, excluded from npm test)
```

**Boot split:** `src/app.ts` builds and **exports** the Express app (no `listen`, no `connectDB` at import time). `src/index.ts` does `dotenv → connectDB → app.listen`. If Render's start command is hard-coded to `node dist/app.js`, change it to `node dist/index.js`.

**Working agreement:** every later phase ships tests for its own acceptance criteria; you're not done until `npm test` is green.

## Architecture (MVC)

Request flow: **`app.ts` → route → middleware (`protect`) → controller → model (Mongoose) → MongoDB**. Cross-cutting logic that isn't a single model lives in `services/`.

```
server/src/
├── app.ts                  # builds + exports Express app (no listen, no connectDB)
├── index.ts                # entry: dotenv, DB connect, listen
├── config/db.ts            # Mongoose connection (uses MONGO_URI)
├── routes/*.routes.ts      # URL → controller wiring, applies auth guards
├── controllers/*.controller.ts   # request handling + business logic
├── models/*.model.ts       # Mongoose schemas (the data contract — source of truth)
├── middlewares/
│   ├── auth.middleware.ts  # protect / optionalAuth / restrictTo
│   └── error.middleware.ts # central error handler (mounted last)
├── services/               # reusable logic across controllers
│   ├── contentAuthorSnapshot.service.ts   # denormalized author_name / collaborator_names
│   ├── learningHistory.service.ts         # touchLearningHistory(user, content)
│   ├── lessonContext.service.ts           # load + serialize lesson from tiptap_json (cached)
│   └── tutor/                             # unified tutor agent (Phase 1+)
│       ├── genaiClient.ts                 # callTutorModel + callTutorModelStream
│       ├── parse.ts                       # parseTutorReply + createSuggestionsGate
│       ├── persona.ts                     # buildSystemInstruction + teacher/personality injection
│       ├── personality.ts                 # student preset catalog + resolvePersonality
│       └── retry.ts                       # isTransientAIError + generateWithRetry
├── types/index.ts          # AuthRequest (Express Request + .user)
└── models/schema.md        # OLDER hand sketch of the model — trust the .model.ts files
```

`app.ts` mounts every route group and ends with `app.use(errorHandler)` — **the error handler must stay last.** Root `GET /` returns a friendly health string.

## API surface

Base URL: `VITE_API_URL` on the client → e.g. `http://localhost:5000`. All app endpoints are under `/api`.

Guard legend: **🔒 protect** (valid JWT required) · **🔓 optionalAuth** (works anonymously, richer if logged in) · **🌐 open** (no auth).

### `/api/auth` — `auth.controller.ts`
| Method | Path | Guard | Purpose |
| --- | --- | --- | --- |
| POST | `/register` | 🌐 | Create account → `{ user, token }` |
| POST | `/login` | 🌐 | Log in → `{ user, token }` |
| GET | `/recheck` | 🔒 | Re-validate token, return fresh user |
| PUT | `/change-password` | 🔒 | Change password |

### `/api/content` — `content.controller.ts`
| Method | Path | Guard | Purpose |
| --- | --- | --- | --- |
| GET | `/load?id=` | 🔓 | Load one lesson, enforcing `access_type` |
| POST | `/create` | 🔒 | Create blank lesson → `{ content_id }` |
| PUT | `/:id` | 🔒 | Update (owner/collaborator); optimistic-concurrency aware |
| DELETE | `/:id` | 🔒 | Delete (owner only) |
| GET | `/search?q=&mine=&explore=` | 🔓 | List lessons (mine / public explore / by title) |

### `/api/content-answer` — `answer.controller.ts`
| Method | Path | Guard | Purpose |
| --- | --- | --- | --- |
| GET | `/:contentId` | 🔒 | Get this user's answers map for a lesson |
| PUT | `/:contentId` | 🔒 | Save one answer `{ blockId, answer }` |
| PUT | `/:contentId/bulk` | 🔒 | Replace the whole `{ answers }` map |

### `/api/history` — `history.controller.ts`
| Method | Path | Guard | Purpose |
| --- | --- | --- | --- |
| GET | `/` | 🔒 | Recently visited lessons (newest first) |
| POST | `/visit/:contentId` | 🔒 | Record/refresh a visit |

### `/api/categories` — `category.controller.ts` (all 🔒)
`GET /` · `POST /` · `PATCH /:id` · `DELETE /:id` · `GET /:id/images` — image-library folders, one set per user.

### `/api/images` — `image.controller.ts` (all 🔒)
`GET /` · `POST /` (save metadata) · `POST /url` (save from URL) · `DELETE /:public_id` · `DELETE /` (clear all) · `PATCH /:public_id/category` — the user's Cloudinary image library.

### `/api/chat` — `tutor.controller.ts` + `memory.controller.ts`
| Method | Path | Guard | Purpose |
| --- | --- | --- | --- |
| POST | `/tutor` | 🔓 optionalAuth + rate limit | **Unified tutor agent** — 4 modes. Optional `stream: true` → SSE (`token`, `suggestions`, `done`, `error` events); JSON mode unchanged as fallback. Optional `personality` string (student preset id). |
| GET | `/memory` | 🔒 protect | Read the logged-in user's `StudentMemory` doc (or `{}`) |
| DELETE | `/memory` | 🔒 protect | Wipe the logged-in user's memory sketch |

**Note:** `/memory` is the only protected chat route — AI usage itself stays open (`optionalAuth` on `/tutor`). The legacy `/ask`, `/feedback`, `/write-evaluate` endpoints and `chat.controller.ts` were **deleted in Tier 0 Phase 0.A** (2026-07-10); every client flow now calls `/tutor`.

### `/api/users` — `user.controller.ts`
`GET /` 🔒 (list) · `POST /` 🌐 (create). `restrictTo(...roles)` exists for role-gating but is lightly used.

### `/api/status` — `status.controller.ts`
`GET /` 🔒 (uptime/memory/platform) · `GET /database` 🌐 · `GET /env` 🌐 · `GET /all` 🌐 — health/diagnostics.

## Data model

Defined in `models/*.model.ts`. Mongoose `timestamps` add `createdAt`/`updatedAt` unless a model overrides the names.

| Model | Key fields | Notes |
| --- | --- | --- |
| **User** | `name`, `email` (unique, lowercased), `password`, `role`, `status` | `role`: `admin \| creator \| learner` (default `learner`). `status`: `active \| blocked \| suspended`. Password auto-hashed (bcrypt, cost 12) in a `pre("save")` hook; `comparePassword()` method. |
| **UserData** | `user_id` (unique), `avatar?`, `bio?`, `metadata` (Mixed) | Optional profile extension. Flexible `metadata` for future use. |
| **Content** | `owner_id`, `collaborators[]`, `title`, `title_image`, `tiptap_json`, `access_type`, `topics[]`, `description`, `agent_settings` | The lesson. `agent_settings`: `{ persona_note, allow_direct_answers, scope, custom_guidelines }` — teacher AI tutor controls (Tier 1.B). `tiptap_json` is the **stringified TipTap document** (default `"{}"`). `access_type`: `public \| link-only \| private` (default `private`). `author_name` + `collaborator_names[]` are **denormalized** copies kept in sync by `contentAuthorSnapshot.service.ts`. |
| **UserContent** | `user_id`, `content_id`, `answers: Map<blockId, any>`, `last_visited` | One row per (user, content). The **student progress / answers** tracker. Unique compound index. |
| **LearningHistory** | `user_id`, `content_id`, `last_accessed` | One row per (user, content) for "recently opened". Unique + `(user_id, last_accessed desc)` index. Updated via `touchLearningHistory()`. |
| **ChatSession** | `user_id`, `content_id`, `block_id`, `messages[]` | Per (user, content, block) tutor conversation. Unique compound index; pre-save hook caps at 50 messages. Logged-in only — anonymous clients pass `clientThread` per request. |
| **StudentMemory** | `user_id` (unique), `interests[]`, `strengths[]`, `growth_areas[]`, `preferences[]`, `recent_topics[]`, `tutor_personality` | One warm sketch per logged-in student (≤10 items per list, ≤120 chars each). `tutor_personality` stores the student's selected preset id (Tier 1.C). Updated async every N student turns via `AI_FAST_MODEL` (`services/tutor/memory.ts`); injected into tutor `systemInstruction` as a digest. Anonymous users have no row. |
| **Category** | `user_id`, `name`, `description` | Image-library folder. Unique per `(user_id, name)`. Uses `created_at` (no `updatedAt`). |
| **Image** | `user_id`, `category_id?`, `public_id` (unique), `secure_url`, `original_filename`, `format`, `bytes`, `width`, `height` | Cloudinary image metadata. Uses `created_at` only. |

**Relationships:** a `User` owns many `Content`; a `Content` has many collaborator `User`s. `(User, Content)` pairs produce `UserContent` (answers) and `LearningHistory` (recency). Each `User` owns `Category` folders that group `Image`s.

## Auth

`middlewares/auth.middleware.ts`:

- **`protect`** — requires `Authorization: Bearer <jwt>`, verifies with `JWT_SECRET`, loads the user (minus password) onto `req.user`. On any failure it returns **401 with a structured body**: `{ message, code, forceRelogin: true, clearToken: true }` where `code` ∈ `TOKEN_MISSING | TOKEN_EXPIRED | TOKEN_INVALID | USER_NOT_FOUND`. **The client relies on this exact shape** to auto-logout — don't change it without updating `client/src/lib/axios.ts`.
- **`optionalAuth`** — sets `req.user` if a valid token is present, otherwise continues anonymously. Used by public-readable content endpoints.
- **`restrictTo(...roles)`** — role guard, use *after* `protect`.

Login/register return `{ user, token }`; the token is a JWT signed with `JWT_SECRET` and `JWT_EXPIRES_IN`. `req.user` typing comes from `AuthRequest` in `types/index.ts`.

## AI integration (Gemini)

> **🔥 Tier 0 in progress.** Phase 0.A (2026-07-10) deleted the legacy endpoints + `chat.controller.ts`; **`POST /api/chat/tutor` is now the only AI endpoint** and every client flow uses it. Read [`../ROADMAP.md`](../ROADMAP.md) before touching AI code. Golden Rules: (1) never ration tokens; (2) anonymous full AI access (`optionalAuth` only on AI routes).

Entry point: `controllers/tutor.controller.ts` (`tutorChat`), logic in `services/tutor/*` + `services/lessonContext.service.ts`. Uses **`@google/genai`**. Output language defaults to **Thai** (`AI_OUTPUT_LANGUAGE`). `generateWithRetry` (`services/tutor/retry.ts`) retries transient network errors (the owner's ISP drops connections) — **keep it** across SDK changes.

**Request contract** (see `tutor.controller.ts` for validation):

| Field | Notes |
| --- | --- |
| `contentId` (required) | Lesson ObjectId; server loads + serializes the lesson itself (`lessonContext.service.ts`, cached by `updatedAt`). |
| `mode` (required) | `free_chat` \| `question_feedback` \| `write_evaluation` \| `followup`. Feedback modes wrap the final user turn with `buildFeedbackUserTurn` (the `[งานของเธอตอนนี้...]` tag that gates evaluation); `free_chat`/`followup` pass the message through untouched — that is the P1 fix. |
| `message` (required) | 1..8000 chars. |
| `blockId` | ≤200 chars; keys the per-block `ChatSession` for logged-in users. |
| `clientThread` | Anonymous users' history (last 30 kept); ignored when logged in. |
| `questionContext` | Required for feedback modes: `{ question, guideAnswer, evaluation: { level (correct\|almost\|incorrect\|ai_judge), accuracyPercent, diagnostics? ≤500 }, feedbackMode }`. `diagnostics` carries deterministic per-choice/per-blank check results. |
| `currentSection` | Optional ≤500-char reading-position hint; appended to the final user turn (all modes). |
| `stream` | Optional `true` → `text/event-stream` with `token` / `suggestions` / `done` / `error` events. Absent/false → JSON `{ reply, suggestions, sessionId }`. |
| `personality` | Optional preset id string (≤40 chars); invalid ids silently default. Layered under teacher `agent_settings`. |

**Response:** `{ reply, suggestions[], sessionId }` — `parseTutorReply` (`services/tutor/parse.ts`) splits the `[SUGGESTIONS]` block into up to 3 chips.

**Model routing** (`resolveTutorModel`): `question_feedback` + `quick_check` → `AI_FAST_MODEL`; everything else → `AI_TUTOR_MODEL`. Persona lives in `services/tutor/persona.ts` (`buildSystemInstruction` — character, teach rules, the intent rule gating evaluation on the feedback tag, length rules, `[SUGGESTIONS]` contract, lesson + questions). `feedbackMode`: `quick_check` (short) | `full_reflection` (longer coaching). The persona enforces a warm, never-shaming tone — **preserve that intent when editing prompts**, and log every change in [`prompt-notes.md`](prompt-notes.md).

Env knobs: `AI_OUTPUT_LANGUAGE` (`thai`|`english`), `AI_FAST_MODEL` (quick_check feedback + memory updates, default `gemini-2.5-flash-lite`), `AI_TUTOR_MODEL` (free chat / reflection / write-eval, default `gemini-2.5-flash`; legacy alias `AI_HEAVY_MODEL`; override to `gemini-3.5-flash` when available), `AI_MEMORY_EVERY_N_TURNS` (logged-in memory update cadence, default `3`), `AI_WRITE_EVAL_MODEL` (legacy write-eval override), `AI_DEBUG_PROMPTS` (`true` to log full prompts — default off), `AI_RATELIMIT_PER_10MIN` / `AI_RATELIMIT_PER_DAY` (bot-only rate limits on `/api/chat/*`, defaults 60/1000).

**Prompt iteration:** edit persona text in `src/services/tutor/persona.ts`; log changes in [`prompt-notes.md`](prompt-notes.md) (date / what felt off / fix).

## Conventions

- **Controllers are `(req: AuthRequest, res: Response) => Promise<void>`.** They validate input defensively (note the `typeof x === "string"` guards in `tutor.controller.ts`), respond, and `return` early on errors.
- **Validation is manual/inline** — no schema-validation library. Match that style.
- **Errors:** throw to reach `error.middleware.ts`, or return an explicit `res.status(...).json(...)`. Existing code mostly does the latter.
- **Mongoose access control** is done in controllers (owner/collaborator checks), not in the schema.

## Environment variables

Create `server/.env` (git-ignored). See [`README.md`](README.md) for descriptions.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no (default 5000) | HTTP port |
| `MONGO_URI` | **yes** | MongoDB connection string |
| `JWT_SECRET` | **yes** | JWT signing secret |
| `JWT_EXPIRES_IN` | yes | Token lifetime (e.g. `7d`) |
| `GEMINI_API_KEY` | **yes** | Google Gemini API key |
| `CLOUDINARY_CLOUD_NAME` | yes | Cloudinary account |
| `CLOUDINARY_UPLOAD_PRESET` | yes | Cloudinary unsigned preset |
| `AI_OUTPUT_LANGUAGE` | no | `thai` (default) or `english` |
| `AI_FAST_MODEL` | no | Quick-check feedback model (default `gemini-2.5-flash-lite`) |
| `AI_TUTOR_MODEL` | no | Free chat / reflection / write-eval tutor model (default `gemini-2.5-flash`; set `gemini-3.5-flash` or `gemini-3-flash-preview` for newer 3-series) |
| `AI_WRITE_EVAL_MODEL` / `AI_HEAVY_MODEL` | no | Legacy aliases — override tutor or write-eval model |
| `AI_DEBUG_PROMPTS` | no | `true` to log full AI prompts (default off) |
| `AI_RATELIMIT_PER_10MIN` / `AI_RATELIMIT_PER_DAY` | no | Bot-only rate limits per IP/user (defaults `60` / `1000`) |

If `MONGO_URI` is bad the process **exits on boot** (`index.ts`). If `GEMINI_API_KEY` is missing, chat endpoints return 500 with a clear message.

## Gotchas

- **Render cold starts.** Free tier sleeps; first request after idle is slow, on top of normal AI latency. The client must show loading states — don't treat slowness as failure.
- **`/api/chat/*` uses `optionalAuth` + bot-only rate limiting (Golden Rules 1 & 2).** Anonymous students *must* keep full AI access — `optionalAuth` only, never `protect`. Rate limits are keyed by IP (or user id when logged in) with generous env-tunable defaults (`AI_RATELIMIT_PER_10MIN=60`, `AI_RATELIMIT_PER_DAY=1000`). `app.set("trust proxy", 1)` ensures real client IPs behind Render's proxy.
- **Optimistic concurrency on content update.** `PUT /content/:id` compares `clientUpdatedAt` to the server's `updatedAt` and returns **409** if the server copy is newer. The client must send `clientUpdatedAt` and handle conflicts.
- **Denormalized author fields.** `author_name` / `collaborator_names` are recomputed via `contentAuthorSnapshot.service.ts` on create and when `collaborators` changes — `updateContent` deliberately drops client-sent values for these. If a user renames themselves, existing content's `author_name` won't auto-update.
- **CORS is wide open** (`app.use(cors())`). Lock down origins before any real production hardening.
- **`schema.md` is stale.** It predates several models/fields. The `.model.ts` files are authoritative.
