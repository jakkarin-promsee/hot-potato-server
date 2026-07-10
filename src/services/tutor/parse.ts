const SUGGESTIONS_MARKER = "[SUGGESTIONS]";
const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_LENGTH = 120;

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
    return { reply: raw.trim(), suggestions: [] };
  }

  const reply = lines.slice(0, markerIndex).join("\n").trim();
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
