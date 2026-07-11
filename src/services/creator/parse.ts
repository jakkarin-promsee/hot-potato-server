/**
 * Tolerant JSON extraction + one-retry ask helper for creator-assist actions
 * (Tier 3.5.A). Gemini JSON mode (`responseMimeType`) is the first line of
 * defense; this is the belt-and-suspenders on top.
 */

export class CreatorAiInvalidError extends Error {
  constructor() {
    super("CREATOR_AI_INVALID");
    this.name = "CreatorAiInvalidError";
  }
}

const JSON_RETRY_NOTE =
  "คำตอบที่แล้วไม่ใช่ JSON ที่ valid — ส่งเฉพาะ JSON ตาม schema เท่านั้น";

/**
 * Parse model output as JSON, tolerating ```json fences and prose around the
 * object. Returns null when nothing parseable is found.
 */
export function parseJsonLoose(raw: string): unknown | null {
  const stripped = raw
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .trim();

  const candidates = [stripped];
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(stripped.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Ask for JSON with exactly one re-ask on parse/validation failure, then give
 * up with CreatorAiInvalidError (→ 500 AI_UNAVAILABLE at the controller).
 */
export async function askJson<T>(
  callModel: (message: string) => Promise<string>,
  message: string,
  validate: (parsed: unknown) => T | null,
): Promise<T> {
  const attempts = [message, `${message}\n\n${JSON_RETRY_NOTE}`];
  for (const attempt of attempts) {
    const raw = await callModel(attempt);
    const parsed = parseJsonLoose(raw);
    if (parsed === null) continue;
    const validated = validate(parsed);
    if (validated !== null) return validated;
  }
  throw new CreatorAiInvalidError();
}
