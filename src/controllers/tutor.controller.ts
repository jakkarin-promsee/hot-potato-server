import { Response } from "express";
import mongoose, { Types } from "mongoose";
import { ChatSession } from "../models/chat_session.model";
import { StudentMemory } from "../models/student_memory.model";
import { getLessonContext } from "../services/lessonContext.service";
import { recordServerError } from "../services/observability.service";
import { callTutorModel, callTutorModelStream } from "../services/tutor/genaiClient";
import {
  buildMemoryDigest,
  runMemoryUpdate,
} from "../services/tutor/memory";
import { createSuggestionsGate, parseTutorReply } from "../services/tutor/parse";
import {
  buildFeedbackUserTurn,
  buildSystemInstruction,
  currentSectionTag,
  followupQuestionTag,
} from "../services/tutor/persona";
import { resolvePersonality } from "../services/tutor/personality";
import { getFastModel, getTutorModel } from "../services/tutor/models";
import { AuthRequest } from "../types";

export { getFastModel, getTutorModel } from "../services/tutor/models";

/** @deprecated Use getFastModel() / getTutorModel() — kept for imports that read defaults at load time. */
export const FAST_MODEL = getFastModel();
/** @deprecated Use getTutorModel() */
export const TUTOR_MODEL = getTutorModel();

const TUTOR_MODES = [
  "free_chat",
  "question_feedback",
  "write_evaluation",
  "followup",
] as const;

type TutorMode = (typeof TUTOR_MODES)[number];

type EvaluationLevel = "correct" | "almost" | "incorrect" | "ai_judge";
type FeedbackMode = "quick_check" | "full_reflection";

interface ClientThreadEntry {
  role: "student" | "tutor";
  text: string;
  createdAt?: string;
}

interface QuestionContextBody {
  question?: unknown;
  guideAnswer?: unknown;
  evaluation?: {
    level?: unknown;
    accuracyPercent?: unknown;
    diagnostics?: unknown;
  };
  feedbackMode?: unknown;
}

interface TutorChatBody {
  contentId?: unknown;
  blockId?: unknown;
  mode?: unknown;
  message?: unknown;
  clientThread?: unknown;
  questionContext?: unknown;
  currentSection?: unknown;
  stream?: unknown;
  personality?: unknown;
}

function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id);
}

function coerceBlockId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.slice(0, 200);
}

function coerceMode(raw: unknown): TutorMode | null {
  if (typeof raw !== "string") return null;
  const mode = raw.trim() as TutorMode;
  return TUTOR_MODES.includes(mode) ? mode : null;
}

function sanitizeClientThread(raw: unknown): ClientThreadEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: ClientThreadEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const role = (item as { role?: unknown }).role;
    const text = (item as { text?: unknown }).text;
    if (role !== "student" && role !== "tutor") continue;
    if (typeof text !== "string" || !text.trim()) continue;
    entries.push({
      role,
      text: text.trim().slice(0, 2000),
      createdAt:
        typeof (item as { createdAt?: unknown }).createdAt === "string"
          ? (item as { createdAt: string }).createdAt
          : undefined,
    });
  }
  return entries.slice(-30);
}

function coerceEvaluationLevel(raw: unknown): EvaluationLevel {
  if (typeof raw !== "string") return "ai_judge";
  const level = raw.trim().toLowerCase();
  if (
    level === "correct" ||
    level === "almost" ||
    level === "incorrect" ||
    level === "ai_judge"
  ) {
    return level;
  }
  return "ai_judge";
}

function coerceAccuracyPercent(raw: unknown): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function coerceFeedbackMode(raw: unknown): FeedbackMode {
  if (typeof raw !== "string") return "quick_check";
  return raw.trim().toLowerCase() === "full_reflection"
    ? "full_reflection"
    : "quick_check";
}

function coerceOptionalText(raw: unknown, maxLength: number): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, maxLength);
}

function parseQuestionContext(
  raw: unknown,
  mode: TutorMode,
):
  | { ok: true; ctx: Required<Pick<QuestionContextBody, never>> & {
      question: string;
      guideAnswer: string;
      level: EvaluationLevel;
      accuracyPercent: number;
      feedbackMode: FeedbackMode;
      diagnostics: string;
    } }
  | { ok: false } {
  if (mode !== "question_feedback" && mode !== "write_evaluation") {
    return {
      ok: true,
      ctx: {
        question: "",
        guideAnswer: "",
        level: "ai_judge",
        accuracyPercent: 0,
        feedbackMode: "quick_check",
        diagnostics: "",
      },
    };
  }

  if (typeof raw !== "object" || raw === null) return { ok: false };
  const qc = raw as QuestionContextBody;
  const question =
    typeof qc.question === "string" ? qc.question.trim() : "";
  if (!question) return { ok: false };

  const guideAnswer =
    typeof qc.guideAnswer === "string" ? qc.guideAnswer.trim() : "";
  const evaluation =
    typeof qc.evaluation === "object" && qc.evaluation !== null
      ? qc.evaluation
      : {};
  const level = coerceEvaluationLevel(evaluation.level);
  const accuracyPercent = coerceAccuracyPercent(evaluation.accuracyPercent);
  const feedbackMode = coerceFeedbackMode(qc.feedbackMode);
  const diagnostics = coerceOptionalText(evaluation.diagnostics, 500);

  return {
    ok: true,
    ctx: { question, guideAnswer, level, accuracyPercent, feedbackMode, diagnostics },
  };
}

export function resolveTutorModel(
  mode: TutorMode,
  feedbackMode: FeedbackMode = "quick_check",
): string {
  if (mode === "question_feedback" && feedbackMode === "quick_check") {
    return getFastModel();
  }
  return getTutorModel();
}

function checkContentAccess(
  lesson: {
    accessType: "public" | "link-only" | "private";
    ownerId: string;
    collaboratorIds: string[];
  },
  userId: string | undefined,
): { ok: true } | { ok: false; status: 401 | 403; message: string } {
  const isPublic = lesson.accessType === "public";
  const isLinkOnly = lesson.accessType === "link-only";

  if (!userId) {
    if (!isPublic && !isLinkOnly) {
      return {
        ok: false,
        status: 401,
        message: "Login required to view this content",
      };
    }
    return { ok: true };
  }

  const isOwner = lesson.ownerId === userId;
  const isCollaborator = lesson.collaboratorIds.includes(userId);
  if (!isPublic && !isLinkOnly && !isOwner && !isCollaborator) {
    return {
      ok: false,
      status: 403,
      message: "No permission to view this content",
    };
  }
  return { ok: true };
}

function coercePersonality(raw: unknown): string {
  if (typeof raw !== "string") return "default";
  return raw.trim().slice(0, 40) || "default";
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: number }).code === 11000
  );
}

async function persistTurn(opts: {
  userId: string;
  contentId: string;
  blockId: string;
  message: string;
  mode: TutorMode;
  reply: string;
  lessonTitle: string;
  session: InstanceType<typeof ChatSession> | null;
  resolvedPersonalityId?: string;
  requestPersonality?: string;
  storedTutorPersonality?: string;
}): Promise<InstanceType<typeof ChatSession> | null> {
  let { session } = opts;
  const newMessages = [
    {
      role: "student" as const,
      text: opts.message,
      mode: opts.mode,
      createdAt: new Date(),
    },
    {
      role: "tutor" as const,
      text: opts.reply,
      mode: opts.mode,
      createdAt: new Date(),
    },
  ];

  const sessionFilter = {
    user_id: new Types.ObjectId(opts.userId),
    content_id: new Types.ObjectId(opts.contentId),
    block_id: opts.blockId,
  };

  if (session) {
    session.messages.push(...newMessages);
    await session.save();
  } else {
    try {
      session = new ChatSession({
        ...sessionFilter,
        messages: newMessages,
      });
      await session.save();
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      session = await ChatSession.findOne(sessionFilter);
      if (!session) throw err;
      session.messages.push(...newMessages);
      await session.save();
    }
  }

  const everyN = Number(process.env.AI_MEMORY_EVERY_N_TURNS) || 3;
  const studentTurns = session.messages.filter((m) => m.role === "student").length;
  if (opts.mode === "write_evaluation" || studentTurns % everyN === 0) {
    void runMemoryUpdate({
      userId: new Types.ObjectId(opts.userId),
      contentId: new Types.ObjectId(opts.contentId),
      lessonTitle: opts.lessonTitle,
      recentTurns: session.messages.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      })),
    }).catch((e) => console.warn("memory update failed:", e));
  }

  if (
    opts.requestPersonality !== undefined &&
    opts.resolvedPersonalityId !== undefined &&
    opts.resolvedPersonalityId !== (opts.storedTutorPersonality ?? "")
  ) {
    void StudentMemory.findOneAndUpdate(
      { user_id: new Types.ObjectId(opts.userId) },
      { $set: { tutor_personality: opts.resolvedPersonalityId } },
      { upsert: true },
    ).catch((e) => console.warn("personality sync failed:", e));
  }

  return session;
}

export const tutorChat = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const body = req.body as TutorChatBody;

  const contentId =
    typeof body.contentId === "string" ? body.contentId.trim() : "";
  if (!contentId || !isValidObjectId(contentId)) {
    res
      .status(400)
      .json({ message: "contentId is required and must be a valid id" });
    return;
  }

  const mode = coerceMode(body.mode);
  if (!mode) {
    res.status(400).json({
      message:
        "mode must be one of: free_chat, question_feedback, write_evaluation, followup",
    });
    return;
  }

  const message =
    typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 8000) {
    res.status(400).json({ message: "message is required" });
    return;
  }

  const qcResult = parseQuestionContext(body.questionContext, mode);
  if (!qcResult.ok) {
    res
      .status(400)
      .json({ message: "questionContext is required for feedback modes" });
    return;
  }

  const blockId = coerceBlockId(body.blockId);
  const clientThread = sanitizeClientThread(body.clientThread);
  const currentSection = coerceOptionalText(body.currentSection, 500);
  const wantStream = body.stream === true;
  const personalityRaw =
    body.personality !== undefined ? coercePersonality(body.personality) : undefined;
  const resolvedPersonality = resolvePersonality(personalityRaw);

  const lesson = await getLessonContext(contentId);
  if (!lesson) {
    res.status(404).json({ message: "Content not found" });
    return;
  }

  const userId = req.user?._id?.toString();
  const access = checkContentAccess(lesson, userId);
  if (!access.ok) {
    res.status(access.status).json({ message: access.message });
    return;
  }

  let history: { role: "student" | "tutor"; text: string }[] = [];
  let session = null;

  if (userId) {
    session = await ChatSession.findOne({
      user_id: new Types.ObjectId(userId),
      content_id: new Types.ObjectId(contentId),
      block_id: blockId,
    });
    if (session) {
      history = session.messages.map((m) => ({
        role: m.role,
        text: m.text,
      }));
    }
  } else {
    history = clientThread.map((t) => ({ role: t.role, text: t.text }));
  }

  // Gemini expects the conversation to open with a user turn; a client-built
  // thread could start with a tutor message in edge cases.
  while (history.length && history[0].role === "tutor") history.shift();

  const geminiHistory = history.map((m) => ({
    role: m.role === "student" ? ("user" as const) : ("model" as const),
    text: m.text,
  }));

  let memoryDigest: string | undefined;
  let storedTutorPersonality = "";
  if (userId) {
    const memory = await StudentMemory.findOne({
      user_id: new Types.ObjectId(userId),
    });
    const digest = buildMemoryDigest(memory);
    if (digest) memoryDigest = digest;
    storedTutorPersonality = memory?.tutor_personality ?? "";
  }

  const systemInstruction = buildSystemInstruction({
    lesson,
    memoryDigest,
    agentSettings: lesson.agentSettings,
    personality: resolvedPersonality,
  });

  let finalUserTurn = message;
  if (mode === "question_feedback" || mode === "write_evaluation") {
    finalUserTurn = buildFeedbackUserTurn({
      question: qcResult.ctx.question,
      guideAnswer: qcResult.ctx.guideAnswer,
      level: qcResult.ctx.level,
      accuracyPercent: qcResult.ctx.accuracyPercent,
      feedbackMode: qcResult.ctx.feedbackMode,
      studentAnswer: message,
      diagnostics: qcResult.ctx.diagnostics,
    });
  }
  if (mode === "followup" && blockId) {
    // A follow-up thread hangs off one question card, but the message itself
    // is raw — anchor it so the model doesn't depend on history (which the
    // 50-message session cap can truncate) to know which question this is.
    const threadQuestion = lesson.questions.find(
      (q) => q.blockId === blockId,
    );
    if (threadQuestion?.question) {
      finalUserTurn += `\n\n${followupQuestionTag(threadQuestion.question)}`;
    }
  }
  if (currentSection) {
    finalUserTurn += `\n\n${currentSectionTag(currentSection)}`;
  }

  const model = resolveTutorModel(mode, qcResult.ctx.feedbackMode);

  // Dev-only flag — logs student messages; never enable in production.
  if (process.env.AI_DEBUG_PROMPTS === "true") {
    console.log(
      `[AI_DEBUG] model=${model} mode=${mode} historyTurns=${history.length}`,
    );
    console.log("[AI_DEBUG] systemInstruction:\n" + systemInstruction);
    console.log("[AI_DEBUG] finalUserTurn:\n" + finalUserTurn);
  }

  const persistOpts = {
    userId: userId!,
    contentId,
    blockId,
    message,
    mode,
    lessonTitle: lesson.title,
    session,
    resolvedPersonalityId: resolvedPersonality.id,
    requestPersonality: personalityRaw,
    storedTutorPersonality,
  };

  if (wantStream) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let clientGone = false;
    req.on("close", () => {
      clientGone = true;
    });

    let raw = "";
    const gate = createSuggestionsGate();
    try {
      for await (const chunk of callTutorModelStream({
        model,
        systemInstruction,
        history: geminiHistory,
        message: finalUserTurn,
      })) {
        raw += chunk;
        if (clientGone) continue;
        const visible = gate.push(chunk);
        if (visible) send("token", { text: visible });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === "MISSING_GEMINI_API_KEY") {
        recordServerError({
          method: req.method,
          route: req.originalUrl ?? "/api/chat/tutor",
          status: 500,
          name: "MISSING_GEMINI_API_KEY",
        });
        if (!clientGone) {
          send("error", { message: "Missing GEMINI_API_KEY in server env" });
        }
        res.end();
        return;
      }
      console.error("Tutor stream failed:", error);
      recordServerError({
        method: req.method,
        route: req.originalUrl ?? "/api/chat/tutor",
        status: 502,
        name: error instanceof Error ? error.name : "Error",
      });
      if (!clientGone) send("error", { message: "AI request failed" });
      res.end();
      return;
    }

    const { reply, suggestions } = parseTutorReply(raw);

    try {
      if (userId) {
        session = await persistTurn({ ...persistOpts, reply, session });
      }

      if (!clientGone) {
        send("suggestions", { suggestions });
        send("done", { reply, sessionId: session?._id ?? null });
      }
    } catch (persistError) {
      console.error("Tutor persist failed:", persistError);
      recordServerError({
        method: req.method,
        route: req.originalUrl ?? "/api/chat/tutor",
        status: 500,
        name: persistError instanceof Error ? persistError.name : "Error",
      });
      if (!clientGone) {
        send("error", { message: "Failed to save session" });
      }
    }
    res.end();
    return;
  }

  try {
    const raw = await callTutorModel({
      model,
      systemInstruction,
      history: geminiHistory,
      message: finalUserTurn,
    });
    const { reply, suggestions } = parseTutorReply(raw);

    if (userId) {
      session = await persistTurn({ ...persistOpts, reply, session });
    }

    res.status(200).json({
      reply,
      suggestions,
      sessionId: session?._id ?? null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "MISSING_GEMINI_API_KEY") {
      recordServerError({
        method: req.method,
        route: req.originalUrl ?? "/api/chat/tutor",
        status: 500,
        name: "MISSING_GEMINI_API_KEY",
      });
      res
        .status(500)
        .json({ message: "Missing GEMINI_API_KEY in server env" });
      return;
    }
    console.error("Tutor AI request failed:", error);
    recordServerError({
      method: req.method,
      route: req.originalUrl ?? "/api/chat/tutor",
      status: 502,
      name: error instanceof Error ? error.name : "Error",
    });
    res.status(502).json({ message: "AI request failed" });
  }
};
