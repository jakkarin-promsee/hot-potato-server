# Prompt notes — Hot Potato AI tutor

Log of real transcripts, what felt off, and what we changed. **Agents editing prompt text in `src/services/tutor/persona.ts` must append an entry here.**

| Date | Transcript snippet / what felt off | Change made |
| --- | --- | --- |
| 2026-07-10 | Default override: `gemini-2.5-flash` (stable `gemini-3-flash` slug 404 on API 2026-07-10). Set `AI_TUTOR_MODEL=gemini-3.5-flash` for 3-series. | Rewrote `persona.ts` with full Phase 2 template: `TUTOR_NAME = "น้องมันฝรั่ง"`, character/teach/length/format sections, optional memory & teacher-note slots, lesson + question injection. Added real `parseTutorReply` in `parse.ts`. Split models: `AI_FAST_MODEL` for quick_check, `AI_TUTOR_MODEL` for free chat & reflection. |

**How to use:** after a manual 10-turn test, paste 1–2 lines that felt wrong in column 2, describe the tweak in column 3, then edit `persona.ts` accordingly.
| 2026-07-10 | Tier 0.A: owner-gate finding P1 — "สวัสดี" in follow-up threads got graded as an answer (legacy flow framed all input as `=== User Answer ===`). | Added intent rule section `== เมื่อไหร่ประเมิน เมื่อไหร่คุยเฉยๆ (สำคัญมาก) ==` to `buildSystemInstruction`: evaluation is gated on the exact `[งานของเธอตอนนี้: ให้ฟีดแบ็กคำตอบของเพื่อน]` tag; everything else (greetings, small talk, meta) is normal friend conversation, never graded. Follow-up re-attempts get conversational coaching, no formal verdict. Also extended `buildFeedbackUserTurn` with optional `รายละเอียดการตรวจ` (diagnostics) line. |
