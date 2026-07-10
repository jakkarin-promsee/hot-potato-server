const SUGGESTIONS_MARKER = "[SUGGESTIONS]";
const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_LENGTH = 120;

/**
 * Report-speak labels the persona forbids (see "== FORMAT (STRICT) ==" in
 * persona.ts). Stripped defensively from replies in case the model leaks one.
 * Regex alternatives — keep in sync with the persona wording and the tests.
 */
export const REPORT_LABELS = [
  "action plan",
  "next steps?",
  "feedback",
  "summary",
  "conclusion",
  "สรุป",
  "แผน(?:การ)?",
  "ขั้นตอน(?:ต่อ|ถัด)ไป",
  "คำแนะนำ(?:เพิ่มเติม)?",
] as const;

// Matches a line-leading label such as "Action Plan:", "**สรุป:**",
// "**Next steps** :" — the colon is REQUIRED so normal prose that merely
// starts with a label word ("สรุปแล้ว...", "แผนของเรา...") is never touched.
const REPORT_LABEL_REGEX = new RegExp(
  `^\\s*(?:\\*\\*\\s*)?(?:${REPORT_LABELS.join("|")})\\s*(?::\\s*\\*\\*|\\*\\*\\s*:|:)\\s*`,
  "i",
);

/** Strip leaked report-style labels from line starts, keeping the content. */
export function stripReportLabels(reply: string): string {
  const lines = reply.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const stripped = line.replace(REPORT_LABEL_REGEX, "");
    // A line that was ONLY a label (content on the next line) disappears.
    if (stripped !== line && !stripped.trim()) continue;
    out.push(stripped);
  }
  return out.join("\n").trim();
}

export function parseTutorReply(raw: string): {
  reply: string;
  suggestions: string[];
} {
  const lines = raw.split("\n");
  let markerIndex = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === SUGGESTIONS_MARKER) {
      markerIndex = i;
      break;
    }
  }

  if (markerIndex === -1) {
    return { reply: stripReportLabels(raw), suggestions: [] };
  }

  const reply = stripReportLabels(lines.slice(0, markerIndex).join("\n"));
  const suggestions: string[] = [];

  for (let i = markerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("- ")) continue;
    const text = line.slice(2).trim();
    if (!text) continue;
    suggestions.push(
      text.length > MAX_SUGGESTION_LENGTH
        ? text.slice(0, MAX_SUGGESTION_LENGTH)
        : text,
    );
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  return { reply, suggestions };
}
