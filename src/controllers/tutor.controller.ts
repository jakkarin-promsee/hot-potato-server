import { Response } from "express";
import mongoose, { Types } from "mongoose";
import { ChatSession } from "../models/chat_session.model";
import { StudentMemory } from "../models/student_memory.model";
import { getLessonContext } from "../services/lessonContext.service";
import { callTutorModel } from "../services/tutor/genaiClient";
import {
  buildMemoryDigest,
  runMemoryUpdate,
} from "../services/tutor/memory";
import { parseTutorReply } from "../services/tutor/parse";
import {
  buildFeedbackUserTurn,
  buildSystemInstruction,
  currentSectionTag,
  followupQuestionTag,
} from "../services/tutor/persona";
import { AuthRequest } from "../types";

export function getFastModel(): string {
  return (process.env.AI_FAST_MODEL || "gemini-2.5-flash-lite").trim();
}

export function getTutorModel(): string {
  return (
    process.env.AI_TUTOR_MODEL ||
    process.env.AI_HEAVY_MODEL ||
    "gemini-2.5-flash"
  ).trim();
}

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
  if (userId) {
    const memory = await StudentMemory.findOne({
      user_id: new Types.ObjectId(userId),
    });
    const digest = buildMemoryDigest(memory);
    if (digest) memoryDigest = digest;
  }

  const systemInstruction = buildSystemInstruction({ lesson, memoryDigest });

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

  try {
    const raw = await callTutorModel({
      model,
      systemInstruction,
      history: geminiHistory,
      message: finalUserTurn,
    });
    const { reply, suggestions } = parseTutorReply(raw);

    if (userId) {
      if (!session) {
        session = new ChatSession({
          user_id: new Types.ObjectId(userId),
          content_id: new Types.ObjectId(contentId),
          block_id: blockId,
          messages: [],
        });
      }
      session.messages.push(
        { role: "student", text: message, mode, createdAt: new Date() },
        { role: "tutor", text: reply, mode, createdAt: new Date() },
      );
      await session.save();

      const everyN = Number(process.env.AI_MEMORY_EVERY_N_TURNS) || 3;
      const studentTurns = session.messages.filter(
        (m) => m.role === "student",
      ).length;
      if (mode === "write_evaluation" || studentTurns % everyN === 0) {
        void runMemoryUpdate({
          userId: new Types.ObjectId(userId),
          contentId: new Types.ObjectId(contentId),
          lessonTitle: lesson.title,
          recentTurns: session.messages.slice(-6).map((m) => ({
            role: m.role,
            text: m.text,
          })),
        }).catch((e) => console.warn("memory update failed:", e));
      }
    }

    res.status(200).json({
      reply,
      suggestions,
      sessionId: session?._id ?? null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "MISSING_GEMINI_API_KEY") {
      res
        .status(500)
        .json({ message: "Missing GEMINI_API_KEY in server env" });
      return;
    }
    console.error("Tutor AI request failed:", error);
    res.status(502).json({ message: "AI request failed" });
  }
};
