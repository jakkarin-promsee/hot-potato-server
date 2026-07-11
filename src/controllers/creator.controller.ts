import { Response } from "express";
import mongoose from "mongoose";
import { getLessonContext, LessonContext } from "../services/lessonContext.service";
import { recordServerError } from "../services/observability.service";
import { callTutorModel } from "../services/tutor/genaiClient";
import { getFastModel, getTutorModel } from "../services/tutor/models";
import { askJson, CreatorAiInvalidError } from "../services/creator/parse";
import {
  buildAgentSettingsPrompt,
  buildCriticPrompt,
  buildDistractorsPrompt,
  buildDraftSectionPrompt,
  buildFormulaLatexPrompt,
  buildGenerateQuestionsPrompt,
  buildGuideAnswerPrompt,
  buildImportStructurePrompt,
  buildLessonMetaPrompt,
  buildOutlinePrompt,
  buildProofreadPrompt,
  CreatorPrompt,
  CRITIC_QUESTION_COUNT_ITEM,
  ProofreadPreset,
} from "../services/creator/prompts";
import {
  QUESTION_TYPES,
  validateAgentSettingsResult,
  validateCriticResult,
  validateDistractorsResult,
  validateFormulaLatexResult,
  validateGenerateQuestionsResult,
  validateImportStructureResult,
  validateLessonMetaResult,
} from "../services/creator/validate";
import { AuthRequest } from "../types";

const CREATOR_ACTIONS = [
  "formula_latex",
  "proofread",
  "generate_questions",
  "guide_answer",
  "distractors",
  "outline",
  "draft_section",
  "import_structure",
  "critic",
  "lesson_meta",
  "agent_settings_suggest",
] as const;

type CreatorAction = (typeof CREATOR_ACTIONS)[number];

const PROOFREAD_PRESETS: ProofreadPreset[] = [
  "proofread",
  "format",
  "simplify",
  "shorten",
  "expand",
  "reading_level",
];

/** Required string field: trimmed, 1..max chars — null means invalid. */
function reqStr(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > max) return null;
  return text;
}

/** Optional string field: missing → "", present-but-invalid → null. */
function optStr(raw: unknown, max: number): string | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length > max) return null;
  return text;
}

async function callPlain(model: string, prompt: CreatorPrompt): Promise<string> {
  return callTutorModel({
    model,
    systemInstruction: prompt.systemInstruction,
    history: [],
    message: prompt.message,
  });
}

/** Plain-text creator actions — empty model output triggers AI_UNAVAILABLE. */
async function callPlainNonEmpty(
  model: string,
  prompt: CreatorPrompt,
): Promise<string> {
  const text = (await callPlain(model, prompt)).trim();
  if (!text) throw new CreatorAiInvalidError();
  return text;
}

async function callJson<T>(
  model: string,
  prompt: CreatorPrompt,
  validate: (parsed: unknown) => T | null,
): Promise<T> {
  return askJson(
    (message) =>
      callTutorModel({
        model,
        systemInstruction: prompt.systemInstruction,
        history: [],
        message,
        responseMimeType: "application/json",
      }),
    prompt.message,
    validate,
  );
}

type ActionOutcome =
  | { ok: true; result: unknown }
  | { ok: false; status: 400; message: string };

function bad(message: string): ActionOutcome {
  return { ok: false, status: 400, message };
}

async function runAction(
  action: CreatorAction,
  payload: Record<string, unknown>,
  lesson: LessonContext,
): Promise<ActionOutcome> {
  switch (action) {
    case "formula_latex": {
      const formulaText = reqStr(payload.formulaText, 300);
      const description = optStr(payload.description, 300);
      const usage = optStr(payload.usage, 300);
      if (!formulaText || description === null || usage === null) {
        return bad("ต้องส่ง formulaText (ไม่เกิน 300 ตัวอักษร)");
      }
      const result = await callJson(
        getFastModel(),
        buildFormulaLatexPrompt({ formulaText, description, usage }),
        validateFormulaLatexResult,
      );
      return { ok: true, result };
    }

    case "proofread": {
      const markdown = reqStr(payload.markdown, 12000);
      const preset = payload.preset as ProofreadPreset;
      if (!markdown) return bad("ต้องส่ง markdown (ไม่เกิน 12000 ตัวอักษร)");
      if (!PROOFREAD_PRESETS.includes(preset)) {
        return bad(`preset ต้องเป็นหนึ่งใน: ${PROOFREAD_PRESETS.join(", ")}`);
      }
      const gradeLevel = optStr(payload.gradeLevel, 40);
      if (gradeLevel === null) return bad("gradeLevel ยาวเกินไป");
      if (preset === "reading_level" && !gradeLevel) {
        return bad("preset reading_level ต้องระบุ gradeLevel");
      }
      const text = await callPlainNonEmpty(
        getFastModel(),
        buildProofreadPrompt({ markdown, preset, gradeLevel }),
      );
      return { ok: true, result: { markdown: text } };
    }

    case "generate_questions": {
      const scope = payload.scope === "selection" ? "selection" : payload.scope === "lesson" ? "lesson" : null;
      if (!scope) return bad('scope ต้องเป็น "lesson" หรือ "selection"');
      let selectionMarkdown = "";
      if (scope === "selection") {
        const sel = reqStr(payload.selectionMarkdown, 12000);
        if (!sel) return bad("scope=selection ต้องส่ง selectionMarkdown");
        selectionMarkdown = sel;
      }
      const typesRaw = payload.types;
      const types = Array.isArray(typesRaw)
        ? [...new Set(typesRaw.filter((t): t is string => typeof t === "string"))]
        : [];
      if (
        !types.length ||
        types.length > 4 ||
        types.some((t) => !(QUESTION_TYPES as readonly string[]).includes(t))
      ) {
        return bad(`types ต้องเป็น array ของ: ${QUESTION_TYPES.join(", ")}`);
      }
      const count = payload.count;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 10) {
        return bad("count ต้องเป็นจำนวนเต็ม 1-10");
      }
      const difficulty =
        payload.difficulty === "easy" ||
        payload.difficulty === "medium" ||
        payload.difficulty === "hard" ||
        payload.difficulty === "mixed"
          ? payload.difficulty
          : payload.difficulty === undefined
            ? "mixed"
            : null;
      if (!difficulty) return bad("difficulty ต้องเป็น easy, medium, hard หรือ mixed");
      const result = await callJson(
        getTutorModel(),
        buildGenerateQuestionsPrompt({
          lesson,
          scope,
          selectionMarkdown,
          types,
          count,
          difficulty,
        }),
        validateGenerateQuestionsResult,
      );
      return { ok: true, result };
    }

    case "guide_answer": {
      const question = reqStr(payload.question, 2000);
      if (!question) return bad("ต้องส่ง question (ไม่เกิน 2000 ตัวอักษร)");
      const text = await callPlainNonEmpty(
        getTutorModel(),
        buildGuideAnswerPrompt({ lesson, question }),
      );
      return { ok: true, result: { guideAnswer: text.slice(0, 2000) } };
    }

    case "distractors": {
      const question = reqStr(payload.question, 2000);
      const correctText = reqStr(payload.correctText, 500);
      if (!question || !correctText) {
        return bad("ต้องส่ง question และ correctText");
      }
      const existingRaw = payload.existing;
      if (existingRaw !== undefined && !Array.isArray(existingRaw)) {
        return bad("existing ต้องเป็น array ของข้อความ");
      }
      const existing = (Array.isArray(existingRaw) ? existingRaw : [])
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim())
        .filter(Boolean)
        .slice(0, 8);
      const result = await callJson(
        getFastModel(),
        buildDistractorsPrompt({ question, correctText, existing }),
        (raw) => validateDistractorsResult({ raw, correctText, existing }),
      );
      return { ok: true, result };
    }

    case "outline": {
      const topic = reqStr(payload.topic, 200);
      const gradeLevel = optStr(payload.gradeLevel, 40);
      const objectives = optStr(payload.objectives, 1000);
      const styleHint = optStr(payload.styleHint, 500);
      if (!topic || gradeLevel === null || objectives === null || styleHint === null) {
        return bad("ต้องส่ง topic (ไม่เกิน 200 ตัวอักษร)");
      }
      const text = await callPlainNonEmpty(
        getTutorModel(),
        buildOutlinePrompt({ topic, gradeLevel, objectives, styleHint }),
      );
      return { ok: true, result: { outlineMarkdown: text } };
    }

    case "draft_section": {
      const heading = reqStr(payload.heading, 200);
      const outlineMarkdown = optStr(payload.outlineMarkdown, 4000);
      const styleHint = optStr(payload.styleHint, 500);
      if (!heading || outlineMarkdown === null || styleHint === null) {
        return bad("ต้องส่ง heading (ไม่เกิน 200 ตัวอักษร)");
      }
      const text = await callPlainNonEmpty(
        getTutorModel(),
        buildDraftSectionPrompt({ lesson, heading, outlineMarkdown, styleHint }),
      );
      return { ok: true, result: { markdown: text } };
    }

    case "import_structure": {
      const rawText = reqStr(payload.rawText, 20000);
      if (!rawText) return bad("ต้องส่ง rawText (ไม่เกิน 20000 ตัวอักษร)");
      const result = await callJson(
        getTutorModel(),
        buildImportStructurePrompt({ lesson, rawText }),
        validateImportStructureResult,
      );
      return { ok: true, result };
    }

    case "critic": {
      const result = await callJson(
        getTutorModel(),
        buildCriticPrompt({ lesson }),
        validateCriticResult,
      );
      // Never let the AI get a countable fact wrong: the question-count
      // checklist item is deterministic.
      const questionPass = lesson.questions.length >= 3;
      const item = result.checklist.find((c) =>
        c.item.includes(CRITIC_QUESTION_COUNT_ITEM),
      );
      if (item) item.pass = questionPass;
      else result.checklist.push({ item: CRITIC_QUESTION_COUNT_ITEM, pass: questionPass });
      return { ok: true, result };
    }

    case "lesson_meta": {
      const result = await callJson(
        getFastModel(),
        buildLessonMetaPrompt({ lesson }),
        validateLessonMetaResult,
      );
      return { ok: true, result };
    }

    case "agent_settings_suggest": {
      const result = await callJson(
        getTutorModel(),
        buildAgentSettingsPrompt({ lesson }),
        validateAgentSettingsResult,
      );
      return { ok: true, result };
    }
  }
}

/**
 * POST /api/creator/assist — the unified teacher AI copilot (Tier 3.5.A).
 * Teacher-only: `protect` on the route + owner/collaborator check here.
 * Model routing: fast = formula_latex, proofread, distractors, lesson_meta;
 * tutor model = everything else.
 */
export const creatorAssist = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const contentId =
    typeof body.contentId === "string" ? body.contentId.trim() : "";
  if (!contentId || !mongoose.isValidObjectId(contentId)) {
    res
      .status(400)
      .json({ message: "contentId is required and must be a valid id" });
    return;
  }

  const action = body.action as CreatorAction;
  if (typeof action !== "string" || !CREATOR_ACTIONS.includes(action)) {
    res.status(400).json({
      message: `action ต้องเป็นหนึ่งใน: ${CREATOR_ACTIONS.join(", ")}`,
    });
    return;
  }

  const payloadRaw = body.payload;
  if (
    payloadRaw !== undefined &&
    (typeof payloadRaw !== "object" || payloadRaw === null || Array.isArray(payloadRaw))
  ) {
    res.status(400).json({ message: "payload ต้องเป็น object" });
    return;
  }
  const payload = (payloadRaw ?? {}) as Record<string, unknown>;

  const lesson = await getLessonContext(contentId);
  if (!lesson) {
    res.status(404).json({ message: "Content not found" });
    return;
  }

  // protect guarantees req.user; creator surface is owner/collaborator only.
  const userId = req.user!._id!.toString();
  const isOwner = lesson.ownerId === userId;
  const isCollaborator = lesson.collaboratorIds.includes(userId);
  if (!isOwner && !isCollaborator) {
    res.status(403).json({ message: "No permission to edit this content" });
    return;
  }

  try {
    const outcome = await runAction(action, payload, lesson);
    if (!outcome.ok) {
      res.status(outcome.status).json({ message: outcome.message });
      return;
    }
    res.status(200).json({ result: outcome.result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "MISSING_GEMINI_API_KEY") {
      recordServerError({
        method: req.method,
        route: req.originalUrl ?? "/api/creator/assist",
        status: 500,
        name: "MISSING_GEMINI_API_KEY",
      });
      res.status(500).json({ message: "Missing GEMINI_API_KEY in server env" });
      return;
    }
    console.error(`Creator AI request failed (${action}):`, error);
    recordServerError({
      method: req.method,
      route: req.originalUrl ?? "/api/creator/assist",
      status: 500,
      name: error instanceof Error ? error.name : "Error",
    });
    res.status(500).json({
      message: "AI ไม่พร้อมใช้งานตอนนี้ ลองใหม่อีกครั้งนะ",
      code: "AI_UNAVAILABLE",
    });
  }
};
