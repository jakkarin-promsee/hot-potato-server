# Hot Potato — Server

The REST API for [Hot Potato](../README.md): authentication, lesson storage, student progress, an image library, and the Google Gemini AI integration.

Built with **Express 5 + TypeScript** on **MongoDB** (Mongoose), with **JWT** auth. Deployed to **Render**.

> Looking for the architecture, API reference, and data model? See [`CLAUDE.md`](CLAUDE.md).

---

## Prerequisites

- Node.js 18+ and npm
- A **MongoDB** database (e.g. MongoDB Atlas) and its connection string
- A **Google Gemini** API key ([Google AI Studio](https://aistudio.google.com/))
- A **Cloudinary** account (cloud name + unsigned upload preset)

## Setup

```bash
cd server
npm install
```

Create a `.env` file in `server/` (it is git-ignored):

```env
PORT=5000
MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>/<db>
JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRES_IN=7d
GEMINI_API_KEY=your-gemini-api-key
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_UPLOAD_PRESET=your-unsigned-preset

# Optional
AI_OUTPUT_LANGUAGE=thai          # or "english" (default: thai)
# AI_WRITE_EVAL_MODEL=gemini-2.5-flash   # override the write-evaluation model
```

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | no | HTTP port (default `5000`) |
| `MONGO_URI` | **yes** | MongoDB connection string; the process exits on boot if it can't connect |
| `JWT_SECRET` | **yes** | Secret used to sign JWTs |
| `JWT_EXPIRES_IN` | yes | Token lifetime, e.g. `7d` |
| `GEMINI_API_KEY` | **yes** | Google Gemini API key (chat endpoints 500 without it) |
| `CLOUDINARY_CLOUD_NAME` | yes | Cloudinary account name |
| `CLOUDINARY_UPLOAD_PRESET` | yes | Cloudinary unsigned upload preset |
| `AI_OUTPUT_LANGUAGE` | no | AI response language: `thai` (default) or `english` |
| `AI_WRITE_EVAL_MODEL` / `AI_HEAVY_MODEL` | no | Override the model used for open-ended answer evaluation |

## Run

```bash
npm run dev      # development: nodemon + ts-node, auto-restart on change
npm run build    # compile TypeScript → dist/
npm start        # production: node dist/app.js  (run build first)
```

The API listens on `http://localhost:5000`. Visit `GET /` for a health check, or `GET /api/status/all` for an aggregated systems check.

## API overview

All app endpoints are under `/api`. Authentication is a JWT `Bearer` token (obtained from `/api/auth/login` or `/register`).

| Group | Base path | What it covers |
| --- | --- | --- |
| Auth | `/api/auth` | register, login, token recheck, change password |
| Content | `/api/content` | create / load / update / delete / search lessons |
| Answers | `/api/content-answer` | save & load student answers per lesson |
| History | `/api/history` | recently visited lessons |
| Categories | `/api/categories` | image-library folders |
| Images | `/api/images` | Cloudinary image library |
| Chat (AI) | `/api/chat` | learning Q&A, answer feedback, write evaluation |
| Users | `/api/users` | user list / create |
| Status | `/api/status` | health & diagnostics |

See [`CLAUDE.md`](CLAUDE.md) for the full per-endpoint reference, guards, and request/response shapes.

## Deployment (Render)

The server runs on Render. Typical setup:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Environment:** set every variable from the table above in the Render dashboard (do **not** rely on a committed `.env`).

> **Cold starts:** on Render's free tier the service sleeps when idle, so the first request after a pause is slow — on top of normal AI latency. The web client shows loading states to account for this.

## Project structure

```
server/src/
├── app.ts              # entry point (DB connect, middleware, routes, listen)
├── config/db.ts        # MongoDB connection
├── routes/             # URL → controller wiring
├── controllers/        # request handlers / business logic
├── models/             # Mongoose schemas (the data contract)
├── middlewares/        # auth + error handling
├── services/           # reusable cross-controller logic
└── types/              # shared TypeScript types
```

## Notes

- No automated tests yet.
- `models/schema.md` is an early hand-drawn sketch and is now out of date — the `*.model.ts` files are authoritative.
