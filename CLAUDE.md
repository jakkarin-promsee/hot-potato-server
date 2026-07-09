# CLAUDE.md — Hot Potato Server

The REST API for Hot Potato: auth, content storage, student progress, image library, and the Google Gemini AI integration. Read the root [`../CLAUDE.md`](../CLAUDE.md) first for cross-cutting context (git layout, the two halves, conventions).

## Stack

- **Runtime:** Node.js, **TypeScript**, `commonjs` modules.
- **Framework:** Express 5.
- **Database:** MongoDB via **Mongoose 9**.
- **Auth:** `jsonwebtoken` (JWT) + `bcryptjs` (password hashing).
- **AI:** `@google/generative-ai` → Gemini.
- **Dev:** `nodemon` + `ts-node` (see `nodemon.json`).
- **Deploy:** Render (free tier — see *Gotchas*).

## Commands

```bash
npm install
npm run dev      # nodemon → ts-node src/app.ts   (auto-restart on change)
npm run build    # tsc → dist/
npm start        # node dist/app.js   (production; run build first)
```

No tests yet. There is no linter configured on the server side.

## Architecture (MVC)

Request flow: **`app.ts` → route → middleware (`protect`) → controller → model (Mongoose) → MongoDB**. Cross-cutting logic that isn't a single model lives in `services/`.

```
server/src/
├── app.ts                  # entry: dotenv, DB connect, CORS, JSON, mount routes, error handler, listen
├── config/db.ts            # Mongoose connection (uses MONGO_URI)
├── routes/*.routes.ts      # URL → controller wiring, applies auth guards
├── controllers/*.controller.ts   # request handling + business logic
├── models/*.model.ts       # Mongoose schemas (the data contract — source of truth)
├── middlewares/
│   ├── auth.middleware.ts  # protect / optionalAuth / restrictTo
│   └── error.middleware.ts # central error handler (mounted last)
├── services/               # reusable logic across controllers
│   ├── contentAuthorSnapshot.service.ts   # denormalized author_name / collaborator_names
│   └── learningHistory.service.ts         # touchLearningHistory(user, content)
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

### `/api/chat` — `chat.controller.ts` 🌐 (see *AI integration*)
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/ask` | Grounded learning Q&A (the student's free questioning) |
| POST | `/feedback` | Feedback on a structured answer given an evaluation level |
| POST | `/write-evaluate` | Deep evaluation of an open-ended written answer |

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
| **Content** | `owner_id`, `collaborators[]`, `title`, `title_image`, `tiptap_json`, `access_type`, `topics[]`, `description` | The lesson. `tiptap_json` is the **stringified TipTap document** (default `"{}"`). `access_type`: `public \| link-only \| private` (default `private`). `author_name` + `collaborator_names[]` are **denormalized** copies kept in sync by `contentAuthorSnapshot.service.ts`. |
| **UserContent** | `user_id`, `content_id`, `answers: Map<blockId, any>`, `last_visited` | One row per (user, content). The **student progress / answers** tracker. Unique compound index. |
| **LearningHistory** | `user_id`, `content_id`, `last_accessed` | One row per (user, content) for "recently opened". Unique + `(user_id, last_accessed desc)` index. Updated via `touchLearningHistory()`. |
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

All in `controllers/chat.controller.ts`. Uses `@google/generative-ai` with `GEMINI_API_KEY`. Default model: **`gemini-2.5-flash-lite`** (constant `MODEL_NAME`). Output language defaults to **Thai** (`AI_OUTPUT_LANGUAGE`).

| Endpoint | Builder | What it does |
| --- | --- | --- |
| `POST /ask` | `buildLearningPrompt` | Learning assistant. Inputs `{ prompt, context, userContext }` → `{ answer }`. `context` = the lesson, `userContext` = prior chat. Grounds answers in the lesson; admits when info is missing. |
| `POST /feedback` | `buildFeedbackPrompt` | Friend-tone feedback for structured answers. Inputs include `evaluationLevel` (`correct\|almost\|incorrect`), `accuracyPercent`, `diagnostics`, `feedbackMode`. **The model must follow the provided evaluation level**, never override it. → `{ feedback }`. |
| `POST /write-evaluate` | `buildWriteEvaluationPrompt` | Deep evaluation of open-ended answers vs a teacher `guideAnswer` (treated as a reference direction, not the only right answer). Uses `WRITE_EVAL_MODEL_NAME`. → `{ feedback }`. |

`feedbackMode`: `quick_check` (short) | `full_reflection` (longer coaching). The prompts enforce a warm, never-shaming tone and end with one actionable next step — **preserve that intent when editing prompts.**

Env knobs: `AI_OUTPUT_LANGUAGE` (`thai`|`english`), `AI_WRITE_EVAL_MODEL` / `AI_HEAVY_MODEL` (override the write-eval model). The controllers `console.log` the full prompt for `feedback`/`write-evaluate` — useful for debugging, consider gating behind a flag for production.

## Conventions

- **Controllers are `(req: AuthRequest, res: Response) => Promise<void>`.** They validate input defensively (note the `typeof x === "string"` guards in `chat.controller.ts`), respond, and `return` early on errors.
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
| `AI_WRITE_EVAL_MODEL` / `AI_HEAVY_MODEL` | no | Override write-eval model |

If `MONGO_URI` is bad the process **exits on boot** (`app.ts`). If `GEMINI_API_KEY` is missing, chat endpoints return 500 with a clear message.

## Gotchas

- **Render cold starts.** Free tier sleeps; first request after idle is slow, on top of normal AI latency. The client must show loading states — don't treat slowness as failure.
- **`/api/chat/*` is unauthenticated (🌐).** Anyone who knows the URL can spend your Gemini quota. If abuse/cost becomes a concern, add `protect` and/or rate limiting (and update the client, which currently calls these without relying on auth).
- **Optimistic concurrency on content update.** `PUT /content/:id` compares `clientUpdatedAt` to the server's `updatedAt` and returns **409** if the server copy is newer. The client must send `clientUpdatedAt` and handle conflicts.
- **Denormalized author fields.** `author_name` / `collaborator_names` are recomputed via `contentAuthorSnapshot.service.ts` on create and when `collaborators` changes — `updateContent` deliberately drops client-sent values for these. If a user renames themselves, existing content's `author_name` won't auto-update.
- **CORS is wide open** (`app.use(cors())`). Lock down origins before any real production hardening.
- **`schema.md` is stale.** It predates several models/fields. The `.model.ts` files are authoritative.
