<div align="center">

# Hot Potato — Server

**The API behind teacher-led lessons and an AI study companion that helps students think through their own questions.**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose_9-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![Gemini](https://img.shields.io/badge/AI-Google_Gemini-4285F4?logo=google&logoColor=white)](https://ai.google.dev)

[**Showcase**](https://hot-potato-client.vercel.app/) · [**Client Repository**](https://github.com/Jakkarin-Promsee/hot-potato-client) · [**Workspace Repository**](https://github.com/jakkarin-promsee/hop-potato-root)

</div>

---

## Overview

Many students have material to read but no one available to discuss a question or test an idea with. Hot Potato supports critical thinking through lessons and question guidance set by teachers, paired with an AI study companion that students can ask open-ended questions. The student interface is Thai-first and phone-first for people with little tech experience; public lessons and AI chat work without an account.

**Teachers own the instructional content and the tutor's direction.** The API stores their lesson document, questions, guide answers, and per-lesson `agent_settings`: response persona, whether to answer directly, lesson-only versus related general discussion, and custom guidelines. The AI can help a teacher structure pasted worksheet, Word, or note text into a draft, but the teacher previews and accepts it before publication. There is no automatic paper scanning in this flow.

This repository contains the **REST API**: an Express 5 + TypeScript service backed by MongoDB, providing JWT authentication (email/password and Google Sign-In), lesson CRUD with access control and optimistic concurrency, per-student answer tracking, a Cloudinary-backed image library, and the entire AI layer — a unified streaming tutor endpoint and an eleven-action teacher copilot.

> **Implementing a feature? Keep the [root workspace repository](https://github.com/jakkarin-promsee/hop-potato-root) alongside this repo.** Its [developer guidebook](https://github.com/jakkarin-promsee/hop-potato-root#developer-guidebook) covers the client/server contract, and its `graphify-out/` knowledge graph links routes, controllers, models, and client consumers. Consult the graph and both current codebases when changing an API response, lesson schema, access rule, or tutor behavior.

> The project-wide overview and illustrated student and teacher use cases are in the [workspace README](https://github.com/jakkarin-promsee/hop-potato-root#readme) and [client README](https://github.com/Jakkarin-Promsee/hot-potato-client#use-cases). This README is the API reference and setup guide.

Two product principles shape the API design:

1. **AI access is never rationed for real students** — no per-student quotas. Rate limiting exists only to stop bots, with generous, environment-tunable thresholds.
2. **Anonymous users keep full access** — the AI tutor and public lesson reads use optional authentication, never a login wall. Logging in only adds persistence (chat history, tutor memory, answer tracking).

## Features

- **Unified AI study companion** — a single `POST /api/chat/tutor` serves four conversation modes (free chat, question feedback, writing evaluation, follow-up). Students can ask beyond a right/wrong answer; the teacher's lesson and per-lesson settings guide the reply. Supports Server-Sent Events streaming with a plain-JSON fallback, follow-up suggestion chips, and six student-selectable tutor personalities.
- **Teacher AI copilot** — `POST /api/creator/assist` exposes eleven authoring actions, including `import_structure` for pasted existing material, lesson outlining, drafting, question generation, and review. This lowers the work of moving teaching material online while keeping the teacher's preview-and-accept step. Generated JSON is validated server-side before it reaches the editor.
- **Teacher-guided tutor style** — `Content.agent_settings` stores the persona note, answer directness, knowledge scope, and custom guidelines for each lesson; the server includes these in the tutor instruction along with the teacher-authored material.
- **Server-owned lesson context** — the server loads and serializes the lesson document for every AI call (cached by `updatedAt`), so clients never ship lesson text over the wire.
- **Student memory** — for logged-in students, a background job periodically distills conversations into a small personalization sketch (interests, strengths, growth areas) that is injected into the tutor's system instruction. Fully viewable and erasable by the student. _(Shelved by default since 2026-07-12 — enable with `AI_MEMORY_ENABLED=true`.)_
- **Authentication** — JWT sessions with bcrypt-hashed passwords, Google Sign-In via verified Google Identity Services ID tokens (find-or-create with safe auto-linking by verified email), role-based guards (`admin` / `creator` / `learner`), and a structured 401 contract the client uses for automatic logout.
- **Lesson storage** — TipTap documents stored per lesson with `public` / `link-only` / `private` access levels, collaborator support, denormalized author snapshots that propagate on rename, and optimistic-concurrency updates (409 on conflict).
- **Resilience** — transient AI network errors are retried; model routing sends lightweight tasks to a fast model and coaching tasks to a stronger one; rate limiters are per-surface so teacher AI usage never consumes the student budget.
- **Observability** — an in-memory error ring buffer and AI health snapshot surfaced through sanitized public status endpoints, with internals restricted to admins.
- **Offline test suite** — Vitest + Supertest + in-memory MongoDB with a mocked Gemini client: no network, no real database, no API key required.

## API use cases

The web client is the usual caller. These are the main journeys through the API; the [route reference](#api-reference) below lists individual endpoints and their guards.

| Journey | Request flow | Authentication |
| --- | --- | --- |
| **Find and read a public lesson** | `GET /api/content/search?explore=true` → `GET /api/content/load?id=<contentId>` | Optional; access checks still apply to private lessons |
| **Ask the study companion anything about an idea** | `POST /api/chat/tutor` with `contentId`, `mode: "free_chat"`, and `message`; use `stream: true` for SSE. The teacher's settings determine whether related general topics are in scope. | Optional; anonymous callers send recent turns in `clientThread` |
| **Answer a question** | The client evaluates a choice/blank or collects writing, then calls `POST /api/chat/tutor` in `question_feedback` or `write_evaluation` mode with `questionContext` | Optional; signed-in users can also save answers through `/api/content-answer/:contentId` |
| **Create and publish a lesson** | `POST /api/content/create` → `PUT /api/content/:id` with the document and access settings | JWT; owner or collaborator for updates |
| **Bring existing material online** | `POST /api/creator/assist` with `action: "import_structure"` and pasted `payload.rawText`; preview the proposed structure and questions in the client | JWT and lesson ownership/collaboration |
| **Guide the tutor's style** | Save `agent_settings` with the lesson: persona note, direct-answer preference, scope, and custom guidelines | JWT and lesson ownership/collaboration |
| **Check service health** | `GET /api/status/all` for a sanitized public view; `GET /api/status/` for admin diagnostics | Public / admin respectively |

For a minimal anonymous tutor request after opening an accessible lesson:

```sh
curl -X POST http://localhost:5000/api/chat/tutor \
  -H 'Content-Type: application/json' \
  -d '{"contentId":"<lesson-object-id>","mode":"free_chat","message":"ช่วยอธิบายหัวข้อนี้หน่อย"}'
```

Use a real lesson ID from the local database. The server loads the lesson context itself and returns JSON with `reply`, `suggestions`, and `sessionId`; add `"stream":true` to receive typed SSE events instead. Teacher and saved-progress routes require `Authorization: Bearer <token>`.

## Tech stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js, TypeScript (CommonJS) |
| Framework | Express 5 |
| Database | MongoDB with Mongoose 9 |
| AI | Google Gemini via `@google/genai` |
| Auth | `jsonwebtoken`, `bcryptjs`, `google-auth-library` |
| Rate limiting | `express-rate-limit` |
| Testing | Vitest, Supertest, `mongodb-memory-server` |
| Dev tooling | nodemon, ts-node |
| Deployment | Render |

## Architecture

The service follows an MVC layout. A request flows through **route → auth middleware → controller → model (Mongoose) → MongoDB**, with cross-cutting logic in a `services/` layer and a central error handler mounted last.

```
src/
├── app.ts                  # builds + exports the Express app (no listen, no DB connect)
├── index.ts                # entry point: dotenv → connect DB → listen
├── config/db.ts            # Mongoose connection
├── routes/                 # URL → controller wiring, applies auth guards
├── controllers/            # request validation + business logic
├── models/                 # Mongoose schemas — the data contract
├── middlewares/
│   ├── auth.middleware.ts  # protect / optionalAuth / restrictTo
│   └── error.middleware.ts # central error handler
├── services/
│   ├── lessonContext.service.ts        # lesson serialization for AI calls (cached)
│   ├── observability.service.ts        # error ring buffer + AI health
│   ├── contentAuthorSnapshot.service.ts # denormalized author names
│   ├── tutor/                          # persona, parsing, streaming, retry,
│   │                                   #   personalities, memory, model routing
│   └── creator/                        # copilot prompts, JSON parsing, validation
└── types/                  # shared TypeScript types (AuthRequest)
```

The app/entry split (`app.ts` exports the app; `index.ts` boots it) keeps the full HTTP surface importable by the test suite without opening ports or touching a real database.

## API reference

All endpoints are under `/api`. Authentication is a JWT `Bearer` token from `/api/auth/login` or `/api/auth/register`.

**Guard levels:** `public` (no auth) · `optional` (works anonymously, richer when logged in) · `auth` (valid JWT required) · `admin` (auth + admin role).

### Auth — `/api/auth`

| Method | Path | Guard | Description |
| --- | --- | --- | --- |
| POST | `/register` | public, rate-limited | Create an account → `{ user, token }` |
| POST | `/login` | public, rate-limited | Log in → `{ user, token }` |
| POST | `/google` | public, rate-limited | Google Sign-In: verifies a GIS ID token, then find-or-create / auto-link by verified email |
| GET | `/recheck` | auth | Re-validate the token, return a fresh user |
| PUT | `/change-password` | auth | Change password |

### Content — `/api/content`

| Method | Path | Guard | Description |
| --- | --- | --- | --- |
| GET | `/load?id=` | optional | Load one lesson, enforcing its access level |
| POST | `/create` | auth | Create a blank lesson → `{ content_id }` |
| PUT | `/:id` | auth | Update (owner/collaborator); optimistic concurrency → 409 on conflict |
| DELETE | `/:id` | auth | Delete (owner only) |
| GET | `/search?q=&mine=&explore=` | optional | List lessons (own / public explore / by title) |

### Student answers — `/api/content-answer`

| Method | Path | Guard | Description |
| --- | --- | --- | --- |
| GET | `/:contentId` | auth | Get this user's answer map for a lesson |
| PUT | `/:contentId` | auth | Save one answer `{ blockId, answer }` |
| PUT | `/:contentId/bulk` | auth | Replace the whole answer map |

### AI chat — `/api/chat`

| Method | Path | Guard | Description |
| --- | --- | --- | --- |
| POST | `/tutor` | optional, rate-limited | The unified tutor agent — four modes (`free_chat`, `question_feedback`, `write_evaluation`, `followup`); set `stream: true` for SSE (`token` / `suggestions` / `done` / `error` events) or omit for JSON `{ reply, suggestions, sessionId }` |
| GET | `/memory` | auth | Read the student's tutor-memory sketch |
| DELETE | `/memory` | auth | Erase the student's tutor memory |

Logged-in users get server-side per-block chat sessions (capped at 50 messages); anonymous users pass their recent thread with each request and lose nothing but persistence.

### Teacher copilot — `/api/creator`

| Method | Path | Guard | Description |
| --- | --- | --- | --- |
| POST | `/assist` | auth + owner/collaborator, rate-limited | One endpoint, eleven actions via `{ contentId, action, payload }`: `outline`, `draft_section`, `import_structure`, `proofread`, `generate_questions`, `guide_answer`, `distractors`, `formula_latex`, `critic`, `lesson_meta`, `agent_settings_suggest` |

### Users, history, media, status

| Group | Base path | Description |
| --- | --- | --- |
| Users | `/api/users` | `GET/PUT /me/profile` (auth); `GET /` lists all users (admin) |
| History | `/api/history` | Recently visited lessons (auth) |
| Categories | `/api/categories` | Image-library folders — full CRUD (auth) |
| Images | `/api/images` | Cloudinary image-library metadata (auth) |
| Status | `/api/status` | `GET /all` aggregated public health check (AI health + sanitized recent errors); `GET /` internals (admin) |

## Data model

| Model | Purpose |
| --- | --- |
| **User** | Account: name, unique email, bcrypt-hashed password (optional for Google-only accounts), `googleId`, role (`admin` / `creator` / `learner`), status |
| **UserData** | Extended profile: avatar, bio, flexible metadata |
| **Content** | A lesson: owner, collaborators, title, stringified TipTap document, access level, topics, description, per-lesson AI tutor settings, denormalized author names |
| **UserContent** | Per (user, lesson) answer map and progress tracker |
| **LearningHistory** | Per (user, lesson) recency record for "recently opened" |
| **ChatSession** | Per (user, lesson, block) tutor conversation, capped at 50 messages |
| **StudentMemory** | One personalization sketch per student: interests, strengths, growth areas, preferences, recent topics, selected tutor personality |
| **Category** / **Image** | The user's Cloudinary image library and its folders |

## AI integration

The tutor lives in `src/services/tutor/` and `src/controllers/tutor.controller.ts`:

- **Persona** — a system instruction built per request from the tutor character (warm, coaching, never shaming), teach rules, the lesson content and its questions, the teacher's per-lesson settings, the student's chosen personality preset, and the student's memory digest.
- **Modes** — feedback modes wrap the student's turn with an evaluation task (the client sends deterministic per-choice/per-blank diagnostics; open-ended answers are judged by the model); `free_chat` and `followup` pass messages through untouched so casual conversation stays casual.
- **Streaming** — SSE with typed events; the non-streaming JSON path shares the same parsing (reply + up to three suggestion chips).
- **Model routing** — quick-check feedback uses a fast model (`gemini-2.5-flash-lite` by default); free chat, reflection, and writing evaluation use the tutor model (`gemini-2.5-flash` by default — switched from `gemini-3.5-flash` on 2026-07-12 for output cost; set `AI_TUTOR_MODEL=gemini-3.5-flash` to flip back). Both are environment-configurable.
- **Retry** — transient network failures are retried with backoff before surfacing an error.

The teacher copilot (`src/services/creator/`) uses Gemini's JSON mode with a tolerant parser and a single retry; generated question blocks are schema-validated server-side and malformed items are dropped, so the editor never receives raw untrusted JSON.

## Security

- Passwords hashed with bcrypt (cost 12) in a model pre-save hook; never returned by any endpoint.
- Google Sign-In verifies ID-token signatures and audience server-side via `google-auth-library`.
- Structured 401 responses (`TOKEN_EXPIRED`, `TOKEN_INVALID`, …) let the client distinguish "log in again" from other failures.
- Role guard (`restrictTo`) keeps diagnostics and user listings admin-only.
- Rate limits on auth and AI routes are keyed by IP (or user ID when available) behind Render's proxy (`trust proxy`).
- CORS allow-list is environment-driven; logs contain no student messages or tokens by default.

## Getting started

### Prerequisites

- **Node.js 20+** and npm
- A **MongoDB** database (e.g. a free MongoDB Atlas cluster)
- A **Google Gemini API key** ([Google AI Studio](https://aistudio.google.com/))
- A **Cloudinary** account (cloud name + unsigned upload preset)
- Optional: a **Google OAuth Web client ID** for Google Sign-In

### Installation

```bash
git clone https://github.com/Jakkarin-Promsee/hot-potato-server.git
cd hot-potato-server
npm install
```

### Environment variables

Create a `.env` file in the project root (git-ignored):

```env
PORT=5000
MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>/<db>
JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRES_IN=7d
GEMINI_API_KEY=your-gemini-api-key
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_UPLOAD_PRESET=your-unsigned-preset

# Optional
GOOGLE_CLIENT_ID=your-google-oauth-client-id
CORS_ORIGINS=http://localhost:5173
AI_OUTPUT_LANGUAGE=thai
```

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | no | HTTP port (default `5000`) |
| `MONGO_URI` | **yes** | MongoDB connection string; the process exits on boot if it cannot connect |
| `JWT_SECRET` | **yes** | Secret used to sign JWTs |
| `JWT_EXPIRES_IN` | yes | Token lifetime, e.g. `7d` |
| `GEMINI_API_KEY` | **yes** | Google Gemini API key |
| `CLOUDINARY_CLOUD_NAME` | yes | Cloudinary account name |
| `CLOUDINARY_UPLOAD_PRESET` | yes | Cloudinary unsigned upload preset |
| `GOOGLE_CLIENT_ID` | no | OAuth Web client ID; required only for `POST /auth/google` |
| `CORS_ORIGINS` | no | Comma-separated allowed browser origins; unset = open (dev only, boot warning) |
| `AI_OUTPUT_LANGUAGE` | no | `thai` (default) or `english` |
| `AI_FAST_MODEL` | no | Model for quick feedback + memory updates (default `gemini-2.5-flash-lite`) |
| `AI_TUTOR_MODEL` | no | Model for free chat / reflection / writing evaluation (default `gemini-2.5-flash`; set `gemini-3.5-flash` to switch back to the premium model) |
| `AI_MEMORY_ENABLED` | no | Student-memory master switch — **default off / shelved**; set `true` to resume the sketch updates + digest injection |
| `AI_MEMORY_EVERY_N_TURNS` | no | Student-memory update cadence when enabled (default `3`) |
| `AI_RATELIMIT_PER_10MIN` / `AI_RATELIMIT_PER_DAY` | no | Bot-only AI rate limits (defaults `60` / `1000`) |
| `AUTH_RATELIMIT_PER_10MIN` | no | Bot guard on login/register per IP (default `100`) |

### Run

```bash
npm run dev      # development: nodemon + ts-node with auto-restart
npm run build    # compile TypeScript → dist/
npm start        # production: node dist/index.js (run build first)
```

The API listens on `http://localhost:5000`. `GET /` returns a friendly health string; `GET /api/status/all` returns the aggregated health check.

## Available scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Development server with auto-restart |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled production build |
| `npm test` | Full offline test suite (in-memory MongoDB, mocked Gemini) |
| `npm run test:watch` | Test suite in watch mode |
| `npm run test:ai` | Live Gemini smoke tests (requires a real API key, costs tokens) |
| `npm run promote -- <email>` | Promote a user to admin |
| `npm run check-models` | Probe which Gemini models the API key can access |

## Testing

```bash
npm test
```

The main suite runs fully **offline**: `mongodb-memory-server` provides a throwaway database and the Gemini client is mocked, so no network, real database, or API key is needed.

```
test/
├── setup.ts       # in-memory Mongo + test environment
├── fixtures/      # committed lesson fixture
├── unit/          # prompt builders, retry logic, lesson serialization
├── api/           # endpoint integration tests via Supertest
└── ai/            # live Gemini smoke tests (excluded from npm test)
```

## Deployment

The API is configured for **Render** as a Node web service:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Environment:** set every required variable from the table above in the Render dashboard, including `CORS_ORIGINS` with the client's production origin.

> **Cold starts:** on Render's free tier the service sleeps when idle, so the first request after a pause takes several seconds on top of normal AI latency. The web client accounts for this with loading states.

## Related repositories

| Repository | Description |
| --- | --- |
| [hot-potato-client](https://github.com/Jakkarin-Promsee/hot-potato-client) | React 19 + TypeScript web client: the lesson editor, viewer, and AI chat surfaces |

## Author

**Jakkarin Promsee** — Computer Engineering, KMUTT

- GitHub: [@Jakkarin-Promsee](https://github.com/Jakkarin-Promsee)
- Email: jakkarin.promsee@gmail.com

## License

Original code and documentation authored by Jakkarin Promsee are licensed under the [MIT License](LICENSE). Third-party code, assets, datasets, and other materials are not covered by this license; their original terms apply.
