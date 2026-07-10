import { Content } from "../models/content.model";

export interface LessonQuestion {
  blockId: string;
  kind: "choice" | "write" | "blank_choice" | "blank_write";
  question: string;
  choices?: { text: string; correct: boolean }[] | string[];
  guideAnswer?: string;
  feedbackMode: string;
}

export interface LessonContext {
  contentId: string;
  updatedAt: Date;
  title: string;
  accessType: "public" | "link-only" | "private";
  ownerId: string;
  collaboratorIds: string[];
  text: string;
  questions: LessonQuestion[];
}

interface TipTapNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
}

const MAX_CACHE_ENTRIES = 100;

const cache = new Map<string, { updatedAt: number; ctx: LessonContext }>();
const cacheInsertionOrder: string[] = [];

function serializeInlineText(node: TipTapNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";

  let text = "";
  for (const child of node.content ?? []) {
    text += serializeInlineText(child);
  }
  return text;
}

function extractGuideAnswer(
  kind: LessonQuestion["kind"],
  attrs: Record<string, unknown>,
): string | undefined {
  if (kind === "write") {
    return typeof attrs.answer === "string" ? attrs.answer : undefined;
  }
  if (kind === "blank_write") {
    const blanks = attrs.blankAnswers;
    if (Array.isArray(blanks)) {
      return blanks
        .filter((b): b is string => typeof b === "string")
        .join(" | ");
    }
    return undefined;
  }
  if (kind === "blank_choice") {
    const choices = attrs.choices;
    const correctByBlank = attrs.correctByBlank;
    if (Array.isArray(choices) && Array.isArray(correctByBlank)) {
      return correctByBlank
        .filter((i): i is number => typeof i === "number")
        .map((i) => (typeof choices[i] === "string" ? choices[i] : ""))
        .filter(Boolean)
        .join(" | ");
    }
    return undefined;
  }
  if (kind === "choice") {
    const choices = attrs.choices;
    if (Array.isArray(choices)) {
      return choices
        .filter(
          (c): c is { text: string; correct: boolean } =>
            typeof c === "object" &&
            c !== null &&
            typeof (c as { text?: unknown }).text === "string" &&
            (c as { correct?: unknown }).correct === true,
        )
        .map((c) => c.text)
        .join(" | ");
    }
    return undefined;
  }
  return undefined;
}

function pushQuestion(
  questions: LessonQuestion[],
  lines: string[],
  questionIndex: number,
  entry: Omit<LessonQuestion, "feedbackMode"> & { feedbackMode?: string },
): void {
  const feedbackMode =
    typeof entry.feedbackMode === "string" ? entry.feedbackMode : "quick_check";
  questions.push({ ...entry, feedbackMode });
  lines.push(`[คำถามที่ ${questionIndex}] ${entry.question}`);
}

function serializeBlock(
  node: TipTapNode,
  lines: string[],
  questions: LessonQuestion[],
  questionCounter: { n: number },
): void {
  const type = node.type ?? "";

  if (type === "QuestionAgent") return;

  if (type === "heading") {
    const level = Number(node.attrs?.level ?? 1);
    const text = serializeInlineText(node).trim();
    if (text) lines.push(`H${level}: ${text}`);
    return;
  }

  if (type === "paragraph") {
    const text = serializeInlineText(node).trim();
    if (text) lines.push(text);
    return;
  }

  if (type === "codeBlock") {
    const text = serializeInlineText(node).trim();
    if (text) lines.push(`Code:\n${text}`);
    return;
  }

  if (type === "blockquote") {
    for (const child of node.content ?? []) {
      const childLines: string[] = [];
      serializeBlock(child, childLines, questions, questionCounter);
      for (const line of childLines) {
        lines.push(`> ${line}`);
      }
    }
    return;
  }

  if (type === "bulletList") {
    for (const item of node.content ?? []) {
      const itemText = getNodeTextContent(item).trim();
      if (itemText) lines.push(`- ${itemText}`);
    }
    return;
  }

  if (type === "orderedList") {
    let i = 1;
    for (const item of node.content ?? []) {
      const itemText = getNodeTextContent(item).trim();
      if (itemText) lines.push(`${i}. ${itemText}`);
      i += 1;
    }
    return;
  }

  if (type === "image") {
    const alt =
      typeof node.attrs?.alt === "string" ? node.attrs.alt.trim() : "";
    lines.push(alt ? `[Image] ${alt}` : "[Image]");
    return;
  }

  if (type === "QuestionChoice") {
    const attrs = node.attrs ?? {};
    const blockId = typeof attrs.id === "string" ? attrs.id : "";
    const question =
      typeof attrs.question === "string" ? attrs.question.trim() : "";
    const choices = Array.isArray(attrs.choices)
      ? (attrs.choices as { text: string; correct: boolean }[])
      : undefined;
    questionCounter.n += 1;
    pushQuestion(questions, lines, questionCounter.n, {
      blockId,
      kind: "choice",
      question,
      choices,
      guideAnswer: extractGuideAnswer("choice", attrs),
      feedbackMode:
        typeof attrs.feedbackMode === "string" ? attrs.feedbackMode : undefined,
    });
    return;
  }

  if (type === "QuestionWrite") {
    const attrs = node.attrs ?? {};
    const blockId = typeof attrs.id === "string" ? attrs.id : "";
    const question =
      typeof attrs.question === "string" ? attrs.question.trim() : "";
    questionCounter.n += 1;
    pushQuestion(questions, lines, questionCounter.n, {
      blockId,
      kind: "write",
      question,
      guideAnswer: extractGuideAnswer("write", attrs),
      feedbackMode:
        typeof attrs.feedbackMode === "string" ? attrs.feedbackMode : undefined,
    });
    return;
  }

  if (type === "QuestionBlankChoice") {
    const attrs = node.attrs ?? {};
    const blockId = typeof attrs.id === "string" ? attrs.id : "";
    const template =
      typeof attrs.template === "string" ? attrs.template.trim() : "";
    const choices = Array.isArray(attrs.choices)
      ? (attrs.choices as string[])
      : undefined;
    questionCounter.n += 1;
    pushQuestion(questions, lines, questionCounter.n, {
      blockId,
      kind: "blank_choice",
      question: template,
      choices,
      guideAnswer: extractGuideAnswer("blank_choice", attrs),
      feedbackMode:
        typeof attrs.feedbackMode === "string" ? attrs.feedbackMode : undefined,
    });
    return;
  }

  if (type === "QuestionBlankWrite") {
    const attrs = node.attrs ?? {};
    const blockId = typeof attrs.id === "string" ? attrs.id : "";
    const template =
      typeof attrs.template === "string" ? attrs.template.trim() : "";
    questionCounter.n += 1;
    pushQuestion(questions, lines, questionCounter.n, {
      blockId,
      kind: "blank_write",
      question: template,
      guideAnswer: extractGuideAnswer("blank_write", attrs),
      feedbackMode:
        typeof attrs.feedbackMode === "string" ? attrs.feedbackMode : undefined,
    });
    return;
  }

  for (const child of node.content ?? []) {
    serializeBlock(child, lines, questions, questionCounter);
  }
}

function getNodeTextContent(node: TipTapNode): string {
  if (node.type === "text") return node.text ?? "";
  let text = "";
  for (const child of node.content ?? []) {
    text += getNodeTextContent(child);
  }
  return text;
}

function parseTiptapDoc(tiptapJson: string): {
  text: string;
  questions: LessonQuestion[];
} {
  let doc: TipTapNode;
  try {
    doc = JSON.parse(tiptapJson) as TipTapNode;
  } catch {
    return { text: "", questions: [] };
  }

  const lines: string[] = [];
  const questions: LessonQuestion[] = [];
  const questionCounter = { n: 0 };

  for (const node of doc.content ?? []) {
    serializeBlock(node, lines, questions, questionCounter);
  }

  return { text: lines.join("\n").trim(), questions };
}

function buildLessonContext(
  content: {
    _id: { toString(): string };
    updatedAt: Date;
    title: string;
    access_type: "public" | "link-only" | "private";
    owner_id: { toString(): string };
    collaborators: { toString(): string }[];
    tiptap_json: string;
  },
): LessonContext {
  const { text, questions } = parseTiptapDoc(content.tiptap_json);
  return {
    contentId: content._id.toString(),
    updatedAt: content.updatedAt,
    title: content.title,
    accessType: content.access_type,
    ownerId: content.owner_id.toString(),
    collaboratorIds: content.collaborators.map((c) => c.toString()),
    text,
    questions,
  };
}

function cacheSet(key: string, ctx: LessonContext): void {
  if (!cache.has(key)) {
    cacheInsertionOrder.push(key);
    if (cacheInsertionOrder.length > MAX_CACHE_ENTRIES) {
      const oldest = cacheInsertionOrder.shift();
      if (oldest) cache.delete(oldest);
    }
  }
  cache.set(key, { updatedAt: ctx.updatedAt.getTime(), ctx });
}

export function clearLessonContextCache(): void {
  cache.clear();
  cacheInsertionOrder.length = 0;
}

export async function getLessonContext(
  contentId: string,
): Promise<LessonContext | null> {
  const content = await Content.findById(contentId).lean();
  if (!content) return null;

  const cacheKey = contentId;
  const updatedAtMs = new Date(content.updatedAt).getTime();
  const hit = cache.get(cacheKey);
  if (hit && hit.updatedAt === updatedAtMs) {
    return hit.ctx;
  }

  const ctx = buildLessonContext(content);
  cacheSet(cacheKey, ctx);
  return ctx;
}

/** @internal — exposed for unit tests */
export function serializeTiptapJsonForTest(tiptapJson: string): {
  text: string;
  questions: LessonQuestion[];
} {
  return parseTiptapDoc(tiptapJson);
}
