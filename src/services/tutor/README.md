# services/tutor/ — the student AI engine

> Updated 2026-07-11 · local quick-reference. **Full tour: [`../../docs/ai-internals.md`](../../docs/ai-internals.md).** Prompt build (Thai, exact): [`../../../asking-flow.md`](../../../asking-flow.md). Tone changes are owner-gated + logged in [`../../prompt-notes.md`](../../prompt-notes.md).

The pipeline behind `POST /api/chat/tutor`. Orchestrated by `controllers/tutor.controller.ts`; these services build the prompt, call Gemini, and parse the reply.

## Files

| File | What it does |
| --- | --- |
| `persona.ts` | **The soul.** `buildSystemInstruction(...)` assembles the system prompt in a fixed order (character → teach rules → safety → when-to-evaluate → format → language/loanword → memory → teacher settings → lesson). Exports the tag constants + `INTERNAL_TAG_PREFIXES`. **Owner-gated.** |
| `parse.ts` | `parseTutorReply` (splits `[SUGGESTIONS]` → ≤3 chips), `stripReportLabels` + `stripInternalTags` (defensive), `createSuggestionsGate` (streaming filter). |
| `genaiClient.ts` | The `@google/genai` boundary — `callTutorModel` (JSON) + `callTutorModelStream` (SSE); optional `responseMimeType` for JSON mode. |
| `retry.ts` | `generateWithRetry` (5 tries, backoff) + `isTransientAIError`. **Load-bearing** — exists for the owner's flaky ISP; never remove (ADR-018). |
| `models.ts` | `getFastModel` / `getTutorModel` + routing (single source of truth for defaults). |
| `personality.ts` | The 6 student presets + `resolvePersonality` (layered *under* teacher `agent_settings`). |
| `memory.ts` | `runMemoryUpdate` (async every N turns, fast model) + `buildMemoryDigest`/`buildMemoryPrompt`. |

## Gotchas
- **`[SUGGESTIONS]` is a 3-file contract:** `persona.ts` ↔ `parse.ts` ↔ client chips. New internal tag? Add its prefix to `INTERNAL_TAG_PREFIXES` (parse uses it to strip leaks).
- Editing `persona.ts` → update snapshot tests **and** append to [`../../prompt-notes.md`](../../prompt-notes.md).
- Output language is read **at call time** (`AI_OUTPUT_LANGUAGE`), not at import.
