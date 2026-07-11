# services/ — cross-cutting logic (not a single model)

> Updated 2026-07-11 · local quick-reference. Anything reused across controllers, or that isn't one model's concern, lives here.

## Files (this folder)

| File | What it does |
| --- | --- |
| `lessonContext.service.ts` | **What the AI "sees":** loads a `Content`, serializes `tiptap_json` → plain text + a `questions[]` list + `agent_settings`, **cached by `updatedAt`** (100-entry LRU). Turns formulas/videos/tables/drawings into text. The reason the client never ships lesson text (ADR-002). |
| `observability.service.ts` | In-memory error ring buffer + last-AI-call health, surfaced (sanitized) on `/status/all`. **Wiped on restart, by design** (ADR-006). Route+code+name only, never messages/bodies. |
| `contentAuthorSnapshot.service.ts` | Maintains the denormalized `author_name`/`collaborator_names` on lessons; `refreshAuthorSnapshotsForUser` propagates a profile rename. |
| `learningHistory.service.ts` | `touchLearningHistory(user, content)` — upserts the "recently opened" record. |

## Subfolders (own READMEs)

| Folder | What |
| --- | --- |
| `tutor/` | The student AI engine — persona, parsing, streaming, retry, personalities, memory, model routing |
| `creator/` | The teacher copilot — prompts, JSON parsing, validation (separate from the tutor persona) |

## Gotcha
- `sanitizeAgentSettings` (in `content.controller`) and `normalizeAgentSettings` (here in `lessonContext`) are two normalizers for the same shape — unify when you touch them ([`../../../notes.md`](../../../notes.md)).
