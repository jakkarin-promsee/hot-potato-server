import { INTERNAL_TAG_PREFIXES } from "./persona";

// Lenient on purpose: models occasionally emit "**[SUGGESTIONS]**",
// "[SUGGESTIONS]:", or lowercase — an unmatched marker leaks the whole
// suggestions block into the visible reply.
export const SUGGESTIONS_MARKER_REGEX = /^[\s*_]*\[suggestions\][\s*_:]*$/i;
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

// Matches a line-leading internal prompt tag such as
// "[งานของเธอตอนนี้: ให้ฟีดแบ็กคำตอบของเพื่อน]" or its bolded variant. The model
// is told these markers are internal (persona anti-echo rule); this strips the
// rare leak so it never reaches the student or gets saved into chat history.
const INTERNAL_TAG_REGEX = new RegExp(
  `^\\s*(?:\\*\\*\\s*)?\\[(?:${INTERNAL_TAG_PREFIXES.join("|")})[^\\]]*\\](?:\\s*\\*\\*)?\\s*:?\\s*`,
);

/** Strip leaked internal prompt tags from line starts, keeping the content. */
export function stripInternalTags(reply: string): string {
  const lines = reply.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const stripped = line.replace(INTERNAL_TAG_REGEX, "");
    // A line that was ONLY a tag disappears.
    if (stripped !== line && !stripped.trim()) continue;
    out.push(stripped);
  }
  return out.join("\n").trim();
}

function cleanReply(reply: string): string {
  return stripReportLabels(stripInternalTags(reply));
}

export function parseTutorReply(raw: string): {
  reply: string;
  suggestions: string[];
} {
  const lines = raw.split("\n");
  let markerIndex = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (SUGGESTIONS_MARKER_REGEX.test(lines[i])) {
      markerIndex = i;
      break;
    }
  }

  if (markerIndex === -1) {
    return { reply: cleanReply(raw), suggestions: [] };
  }

  const reply = cleanReply(lines.slice(0, markerIndex).join("\n"));
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

/**
 * Incremental filter for streamed tutor text. Feed raw model chunks; it
 * returns the newly-safe-to-emit visible text. Everything from the
 * [SUGGESTIONS] marker line onward is withheld. A trailing partial line is
 * withheld only while it could still become a bracket-tag line (starts with
 * optional whitespace, asterisk, or underscore, then "["), so normal prose streams unbuffered.
 */
export function createSuggestionsGate(): { push(chunk: string): string } {
  let buffer = "";
  let stopped = false;
  const MAYBE_TAG = /^[\s*_]*\[/;
  return {
    push(chunk: string): string {
      if (stopped) return "";
      buffer += chunk;
      let out = "";
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (SUGGESTIONS_MARKER_REGEX.test(line)) {
          stopped = true;
          return out;
        }
        out += line + "\n";
      }
      if (buffer && !MAYBE_TAG.test(buffer)) {
        out += buffer;
        buffer = "";
      }
      return out;
    },
  };
}
