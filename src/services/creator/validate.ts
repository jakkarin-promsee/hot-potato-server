/**
 * Server-side validation for creator-assist JSON results (Tier 3.5.A).
 *
 * The AI never emits raw TipTap JSON — blocks come back as the typed shapes
 * below and are validated here before the client ever sees them. Malformed
 * question items are DROPPED (not fatal); a validator returning null means
 * "unusable result" and triggers the one-retry path in parse.ts.
 */

export type GeneratedQuestion =
  | {
      type: "choice";
      question: string;
      choices: { text: string; correct: boolean }[];
    }
  | { type: "write"; question: string; guideAnswer: string }
  | {
      type: "blank_choice";
      template: string;
      choices: string[];
      correctByBlank: number[];
    }
  | { type: "blank_write"; template: string; blankAnswers: string[] };

export const QUESTION_TYPES = [
  "choice",
  "write",
  "blank_choice",
  "blank_write",
] as const;

const MAX_QUESTION_CHARS = 2000;
const MAX_CHOICE_CHARS = 500;

function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > max) return null;
  return text;
}

/** Clamp instead of reject — for fields where truncation is acceptable. */
function clampText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, max);
}

/**
 * Generated templates must use [Q-1]..[Q-n], contiguous from 1, each once.
 * The model sometimes emits the client's alternate {{n}} syntax — normalize
 * it rather than dropping the item.
 */
function normalizeTemplate(raw: unknown): { template: string; blanks: number } | null {
  const text = cleanText(raw, MAX_QUESTION_CHARS);
  if (!text) return null;
  const template = text.replace(/\{\{(\d+)\}\}/g, "[Q-$1]");
  const numbers = [...template.matchAll(/\[Q-(\d+)\]/g)].map((m) =>
    Number(m[1]),
  );
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) return null; // gap or duplicate
  }
  return { template, blanks: numbers.length };
}

function sanitizeQuestionItem(raw: unknown): GeneratedQuestion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;

  if (item.type === "choice") {
    const question = cleanText(item.question, MAX_QUESTION_CHARS);
    if (!question || !Array.isArray(item.choices)) return null;
    const choices: { text: string; correct: boolean }[] = [];
    for (const c of item.choices) {
      if (typeof c !== "object" || c === null) return null;
      const text = cleanText((c as Record<string, unknown>).text, MAX_CHOICE_CHARS);
      const correct = (c as Record<string, unknown>).correct;
      if (!text || typeof correct !== "boolean") return null;
      choices.push({ text, correct });
    }
    if (choices.length < 3 || choices.length > 5) return null;
    if (choices.filter((c) => c.correct).length !== 1) return null;
    return { type: "choice", question, choices };
  }

  if (item.type === "write") {
    const question = cleanText(item.question, MAX_QUESTION_CHARS);
    const guideAnswer = cleanText(item.guideAnswer, MAX_QUESTION_CHARS);
    if (!question || !guideAnswer) return null;
    return { type: "write", question, guideAnswer };
  }

  if (item.type === "blank_choice") {
    const normalized = normalizeTemplate(item.template);
    if (!normalized || !Array.isArray(item.choices) || !Array.isArray(item.correctByBlank)) {
      return null;
    }
    const choices: string[] = [];
    for (const c of item.choices) {
      const text = cleanText(c, MAX_CHOICE_CHARS);
      if (!text) return null;
      choices.push(text);
    }
    if (choices.length < 2 || choices.length > 8) return null;
    if (item.correctByBlank.length !== normalized.blanks) return null;
    const correctByBlank: number[] = [];
    for (const idx of item.correctByBlank) {
      if (
        typeof idx !== "number" ||
        !Number.isInteger(idx) ||
        idx < 0 ||
        idx >= choices.length
      ) {
        return null;
      }
      correctByBlank.push(idx);
    }
    return { type: "blank_choice", template: normalized.template, choices, correctByBlank };
  }

  if (item.type === "blank_write") {
    const normalized = normalizeTemplate(item.template);
    if (!normalized || !Array.isArray(item.blankAnswers)) return null;
    if (item.blankAnswers.length !== normalized.blanks) return null;
    const blankAnswers: string[] = [];
    for (const a of item.blankAnswers) {
      const text = cleanText(a, MAX_CHOICE_CHARS);
      if (!text) return null;
      blankAnswers.push(text);
    }
    return { type: "blank_write", template: normalized.template, blankAnswers };
  }

  return null;
}

/** Drop malformed items, keep valid siblings. */
export function sanitizeGeneratedQuestions(raw: unknown): GeneratedQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: GeneratedQuestion[] = [];
  for (const item of raw) {
    const clean = sanitizeQuestionItem(item);
    if (clean) out.push(clean);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-action result validators. Return null → parse.ts retries once → 500.
// ---------------------------------------------------------------------------

export function validateGenerateQuestionsResult(
  raw: unknown,
): { questions: GeneratedQuestion[] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const questions = sanitizeGeneratedQuestions(
    (raw as Record<string, unknown>).questions,
  );
  if (!questions.length) return null; // everything dropped = unusable
  return { questions };
}

export function validateFormulaLatexResult(
  raw: unknown,
): { latex: string; note?: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const latex = cleanText(r.latex, 2000);
  if (!latex) return null;
  const note = clampText(r.note, 500);
  return note ? { latex, note } : { latex };
}

export function validateDistractorsResult(opts: {
  raw: unknown;
  correctText: string;
  existing: string[];
}): { distractors: string[] } | null {
  if (typeof opts.raw !== "object" || opts.raw === null) return null;
  const list = (opts.raw as Record<string, unknown>).distractors;
  if (!Array.isArray(list)) return null;
  const taken = new Set(
    [opts.correctText, ...opts.existing].map((t) => t.trim().toLowerCase()),
  );
  const out: string[] = [];
  for (const item of list) {
    const text = cleanText(item, MAX_CHOICE_CHARS);
    if (!text) continue;
    const key = text.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(text);
    if (out.length === 3) break;
  }
  return out.length === 3 ? { distractors: out } : null;
}

export interface CriticIssue {
  area: "accuracy" | "completeness" | "readability" | "age_fit" | "questions";
  severity: "info" | "warn";
  where: string;
  note: string;
  suggestion?: string;
}

export interface CriticResult {
  summary: string;
  issues: CriticIssue[];
  checklist: { item: string; pass: boolean }[];
}

const CRITIC_AREAS = new Set([
  "accuracy",
  "completeness",
  "readability",
  "age_fit",
  "questions",
]);

export function validateCriticResult(raw: unknown): CriticResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const summary = cleanText(r.summary, 1000);
  if (!summary) return null;

  const issues: CriticIssue[] = [];
  if (Array.isArray(r.issues)) {
    for (const item of r.issues) {
      if (typeof item !== "object" || item === null) continue;
      const i = item as Record<string, unknown>;
      const note = cleanText(i.note, 1000);
      if (!note) continue;
      if (typeof i.area !== "string" || !CRITIC_AREAS.has(i.area)) continue;
      const severity = i.severity === "warn" ? "warn" : "info";
      const issue: CriticIssue = {
        area: i.area as CriticIssue["area"],
        severity,
        where: clampText(i.where, 120),
        note,
      };
      const suggestion = clampText(i.suggestion, 1000);
      if (suggestion) issue.suggestion = suggestion;
      issues.push(issue);
      if (issues.length === 12) break;
    }
  }

  const checklist: { item: string; pass: boolean }[] = [];
  if (Array.isArray(r.checklist)) {
    for (const item of r.checklist) {
      if (typeof item !== "object" || item === null) continue;
      const c = item as Record<string, unknown>;
      const label = cleanText(c.item, 200);
      if (!label || typeof c.pass !== "boolean") continue;
      checklist.push({ item: label, pass: c.pass });
    }
  }
  if (!checklist.length) return null;

  return { summary, issues, checklist };
}

export function validateLessonMetaResult(
  raw: unknown,
): { title: string; description: string; topics: string[] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const title = cleanText(r.title, 120);
  if (!title) return null;
  const description = clampText(r.description, 500);
  const topics: string[] = [];
  if (Array.isArray(r.topics)) {
    for (const t of r.topics) {
      const text = cleanText(t, 40);
      if (text) topics.push(text);
      if (topics.length === 5) break;
    }
  }
  return { title, description, topics };
}

export interface AgentSettingsSuggestion {
  persona_note: string;
  custom_guidelines: string;
  scope: "lesson_only" | "lesson_plus_general";
  allow_direct_answers: boolean;
  reason: string;
}

export function validateAgentSettingsResult(
  raw: unknown,
): AgentSettingsSuggestion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const scope =
    r.scope === "lesson_only" || r.scope === "lesson_plus_general"
      ? r.scope
      : null;
  if (!scope) return null;
  if (typeof r.allow_direct_answers !== "boolean") return null;
  // Same limits Content.agent_settings sanitization uses (500 / 1000).
  return {
    persona_note: clampText(r.persona_note, 500),
    custom_guidelines: clampText(r.custom_guidelines, 1000),
    scope,
    allow_direct_answers: r.allow_direct_answers,
    reason: clampText(r.reason, 300),
  };
}

export function validateImportStructureResult(
  raw: unknown,
): { markdown: string; suggestedQuestions: GeneratedQuestion[] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const markdown = typeof r.markdown === "string" ? r.markdown.trim() : "";
  if (!markdown) return null;
  const suggestedQuestions = sanitizeGeneratedQuestions(
    r.suggestedQuestions,
  ).slice(0, 5);
  return { markdown, suggestedQuestions };
}
