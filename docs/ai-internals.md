# ai-internals.md — the tutor engine, module by module

> Updated 2026-07-11 · a code tour of `server/src/services/tutor/*` + `controllers/tutor.controller.ts`. **Companion to [`../../asking-flow.md`](../../asking-flow.md)** — that doc (Thai) tells you the *exact prompt* Gemini sees; this one tells you *which code builds it* and what must stay true. Prompt-tone changes are logged in [`../prompt-notes.md`](../prompt-notes.md) and are **owner-gated**.

The tutor is one endpoint (`POST /api/chat/tutor`) orchestrated by `tutor.controller.ts`, which pulls from six small services. Think of it as a pipeline: **validate → load context → build system instruction → assemble history → build final turn → route model → generate (with retry) → parse → stream/respond.**

---

## The controller: `tutor.controller.ts` (`tutorChat`)

The orchestrator. Its job is defensive validation + wiring, not cleverness.

- **Input validation is manual and paranoid** — a family of `coerce*` helpers (`coerceMode`, `coerceBlockId`, `coerceFeedbackMode`, `coerceEvaluationLevel`, `coerceAccuracyPercent`, …) sanitize every field before use. `message` is 1..8000 chars; `blockId` ≤200; `clientThread` capped. Match this style — there's no validation library.
- **The four modes** decide the shape (`free_chat` | `question_feedback` | `write_evaluation` | `followup`). Feedback modes wrap the turn with the evaluation task tag; `free_chat`/`followup` pass the message through raw. (Why "สวัสดี" isn't graded: ADR-012.)
- **History source depends on auth:** logged-in → `ChatSession(user, content, block)` (cap 50); anonymous → the request's `clientThread` (cap 30 × 2000 chars). Either way it's normalized to user/model turns starting with a user turn.
- **Two response paths, one parser:** `stream: true` → SSE (`token` / `suggestions` / `done` / `error`); else JSON `{ reply, suggestions, sessionId }`. Both end in `parseTutorReply`.
- **Access + guards:** `optionalAuth` (Golden Rule 2 — never `protect`), `createChatRateLimiter()` (bot-only). `checkContentAccess` gates private lessons.

---

## `lessonContext.service.ts` — what the AI "sees"

Loads the `Content`, serializes `tiptap_json` → **plain text + a `questions[]` list + `agent_settings`**, cached by `updatedAt` (100-entry LRU). The serializer turns non-text blocks into text the model can reason about: `formulaBlock → [Formula] latex`, `youtube → [Video] src`, `fabricCanvas → [Drawing…] placeholder`, `table → | piped | rows |`, and each question into `[คำถามที่ n] …` plus its choices/guide answer. **This — not client-sent text — is the lesson context** (ADR-002). Guide answers are extracted per type (`extractGuideAnswer`: correct choices joined, `blankAnswers`, `correctByBlank`).

---

## `persona.ts` — the system instruction (the product's soul)

`buildSystemInstruction(...)` assembles the system prompt **in a fixed order** (detailed in [`../../asking-flow.md`](../../asking-flow.md) §2): character "น้องมันฝรั่ง" → how-to-teach → **friend-safety rule** (overrides all) → **when-to-evaluate** (gated on the exact `[งานของเธอตอนนี้…]` tag) → length rules → **FORMAT (STRICT)** (+ anti-echo) → output language (+ loanword rule) → StudentMemory digest (login) → teacher `agent_settings` → the lesson text + questions.

**Invariants when editing here:**
- Tags are **exported constants** (`FEEDBACK_TASK_TAG`, `currentSectionTag()`, `followupQuestionTag()`) and every internal bracket-tag prefix must be in **`INTERNAL_TAG_PREFIXES`** — `parse.ts` uses that list to strip leaks. Add a tag → add its prefix.
- The tone is **owner-gated**; update the snapshot tests (`test/unit/persona.test.ts`) and append to [`../prompt-notes.md`](../prompt-notes.md) on any change.
- Output language is read **at call time** (`AI_OUTPUT_LANGUAGE`), not at import.

---

## `parse.ts` — turning model text into a safe reply + chips

Three guards, all defense-in-depth against the model misbehaving:

- **`parseTutorReply(raw)`** finds the **last** `[SUGGESTIONS]` marker (lenient regex — matches `**[SUGGESTIONS]**`, `[SUGGESTIONS]:`, lowercase, because an unmatched marker leaks the whole block), splits the reply from up to 3 `- ` bullets (≤120 chars each).
- **`stripReportLabels`** removes line-leading report-speak (`Action Plan:`, `สรุป:`, …) — **the colon is required**, so normal prose starting with a label word is untouched. Keep `REPORT_LABELS` in sync with the persona's FORMAT section + tests.
- **`stripInternalTags`** removes any leaked internal bracket-tag line (using `INTERNAL_TAG_PREFIXES`) so it never reaches the student or gets saved to history.
- **`createSuggestionsGate()`** is the **streaming** version: feed it raw chunks, it returns safe-to-emit text and withholds everything from the `[SUGGESTIONS]` line onward. It buffers a trailing partial line only while it could still become a bracket-tag (`^[\s*_]*\[`), so normal prose streams unbuffered.

**The `[SUGGESTIONS]` format is a 3-file contract:** `persona.ts` (emits) ↔ `parse.ts` (splits) ↔ client chips. Change all three + tests together.

---

## `genaiClient.ts` — the Gemini boundary

Wraps `@google/genai`: `callTutorModel` (JSON) + `callTutorModelStream` (SSE). Gained an optional `responseMimeType` for Gemini **JSON mode** (used by the creator copilot; config is byte-identical when omitted — regression-tested). All calls go through `generateWithRetry`.

## `retry.ts` — resilience (load-bearing, not polish)

`generateWithRetry(call, tries=5)` retries when `isTransientAIError` matches (`fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network|timeout|503|429|overloaded|unavailable`), with linear backoff (`1000 × attempt` ms). **It exists because the owner's ISP drops connections** — never delete or bypass it; observability hooks its outcomes (ADR-018).

## `models.ts` — model routing (single source of truth)

`getFastModel()` = `AI_FAST_MODEL || gemini-2.5-flash-lite`; `getTutorModel()` = `AI_TUTOR_MODEL || AI_HEAVY_MODEL(legacy) || gemini-3.5-flash`. `resolveTutorModel` sends `question_feedback`+`quick_check` to the fast model, everything else to the tutor model. Defaults were chosen via `npm run check-models` (logged in `prompt-notes.md`).

## `personality.ts` & `memory.ts` — student tuning

- **`personality.ts`** — a catalog of **6 student presets** + `resolvePersonality` (invalid id silently defaults). Injected **under** the teacher's `agent_settings` (ADR-013).
- **`memory.ts`** — `runMemoryUpdate` distills recent turns into `StudentMemory` **async, every `AI_MEMORY_EVERY_N_TURNS` (default 3)** student messages, using the fast model; `buildMemoryDigest`/`buildMemoryPrompt` inject the sketch into the system instruction for logged-in students. Anonymous users have no memory.

---

## Where to change what (cheat sheet)

| Want to change… | Edit | Also do |
| --- | --- | --- |
| Tutor tone/character/rules | `persona.ts` | snapshot tests + `prompt-notes.md` + owner gate |
| What the AI sees in a lesson | `lessonContext.service.ts` | serializer unit tests |
| Suggestion/label/tag handling | `parse.ts` | keep the 3-file `[SUGGESTIONS]` contract + tests |
| Model defaults/routing | `models.ts` | `check-models`, log in `prompt-notes.md` |
| Student memory cadence/shape | `memory.ts` | clamp `AI_MEMORY_EVERY_N_TURNS` (see notes.md) |
| A new mode / input field | `tutor.controller.ts` | add a `coerce*` guard + supertest |

*The teacher copilot (`services/creator/*`) mirrors this pipeline but is teacher-only and JSON-mode; see [`../../docs/data-flow.md`](../../docs/data-flow.md) §6.*
