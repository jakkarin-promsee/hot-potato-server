/** Single source of truth for Gemini model defaults (Tier 3.B). */

/**
 * Tutor default. **Switched `gemini-3.5-flash` → `gemini-2.5-flash` on
 * 2026-07-12** — 3.5-flash output pricing was too expensive, and warm coaching
 * (which students/teachers respond to well) lands fine on 2.5-flash. Both passed
 * the model check (see prompt-notes.md 2026-07-10).
 *
 * The "switch back" button is the **`AI_TUTOR_MODEL` env var**: set
 * `AI_TUTOR_MODEL=gemini-3.5-flash` (in Render, no rebuild) to flip the whole
 * tutor + heavier creator actions to the premium model for a special occasion.
 * The premium slug is kept here so it's copy-pasteable.
 */
export const DEFAULT_TUTOR_MODEL = "gemini-2.5-flash";
export const PREMIUM_TUTOR_MODEL = "gemini-3.5-flash"; // opt-in via AI_TUTOR_MODEL

export function getFastModel(): string {
  return (process.env.AI_FAST_MODEL || "gemini-2.5-flash-lite").trim();
}

export function getTutorModel(): string {
  return (
    process.env.AI_TUTOR_MODEL ||
    process.env.AI_HEAVY_MODEL ||
    DEFAULT_TUTOR_MODEL
  ).trim();
}
