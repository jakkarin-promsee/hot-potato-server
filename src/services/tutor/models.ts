/** Single source of truth for Gemini model defaults (Tier 3.B). */

export function getFastModel(): string {
  return (process.env.AI_FAST_MODEL || "gemini-2.5-flash-lite").trim();
}

export function getTutorModel(): string {
  return (
    process.env.AI_TUTOR_MODEL ||
    process.env.AI_HEAVY_MODEL ||
    "gemini-3.5-flash"
  ).trim();
}
