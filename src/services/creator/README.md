# services/creator/ — the teacher copilot engine

> Updated 2026-07-11 · local quick-reference. Flow: [`../../../docs/data-flow.md`](../../../docs/data-flow.md) §6. Separate from the tutor persona — but tone changes still get logged in [`../../prompt-notes.md`](../../prompt-notes.md).

Powers `POST /api/creator/assist` (11 teacher-only authoring actions). Distinct prompt family from the student tutor — it does **not** import `persona.ts`.

## Files

| File | What it does |
| --- | --- |
| `prompts.ts` | `build<Action>Prompt` per action (outline, draft_section, import_structure, proofread, generate_questions, guide_answer, distractors, formula_latex, critic, lesson_meta, agent_settings_suggest). Shares the `AI_OUTPUT_LANGUAGE` + loanword rule; question prompts carry the product spirit (คิดวิเคราะห์ > ท่องจำ; distractors = common misconceptions). |
| `parse.ts` | Tolerant JSON extractor + one-retry `askJson` (models wrap JSON in prose/fences). |
| `validate.ts` | Server-side validation of generated blocks — **drops malformed items**, so the editor never receives raw untrusted JSON. |

## Gotchas
- **AI never emits raw TipTap doc JSON** — prose is markdown, blocks are typed JSON validated here (ADR-009). The client then does preview→accept.
- JSON actions use Gemini JSON mode (`callTutorModel` with `responseMimeType`); model routing sends light actions to the fast model.
- Verbatim proofread presets must **not** alter wording (loanword rule exempt for those).
