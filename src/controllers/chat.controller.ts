import { Request, Response } from "express";
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

interface AskChatBody {
  prompt?: unknown;
  context?: unknown;
  userContext?: unknown;
}

interface AskFeedbackBody {
  question?: unknown;
  correctAnswer?: unknown;
  userAnswer?: unknown;
  evaluationLevel?: unknown;
  accuracyPercent?: unknown;
  diagnostics?: unknown;
  feedbackMode?: unknown;
}

interface AskWriteEvaluationBody {
  question?: unknown;
  guideAnswer?: unknown;
  studentAnswer?: unknown;
  feedbackMode?: unknown;
}

type FeedbackMode = "quick_check" | "full_reflection";

// Transient network/service failures (dropped socket on a flaky link, Gemini
// briefly overloaded, rate limit). These are worth retrying; anything else is not.
const isTransientAIError = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network|timeout|503|429|overloaded|unavailable/i.test(
    msg,
  );
};

// Wrap generateContent so a transient network blip becomes a silent retry
// instead of a failed answer for the student. The ISP here drops outbound
// connections for a few seconds at a time, and each Gemini call opens a fresh
// connection, so we retry across a wide-enough window to outlast a typical
// blip: 5 attempts, backing off 1s, 2s, 3s, 4s (~10s total) before giving up.
async function generateWithRetry(
  model: GenerativeModel,
  prompt: string,
  tries = 5,
) {
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await model.generateContent(prompt);
    } catch (error) {
      last = error;
      if (attempt === tries || !isTransientAIError(error)) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `Gemini transient error (attempt ${attempt}/${tries}), retrying: ${msg}`,
      );
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw last;
}

const MODEL_NAME = "gemini-2.5-flash-lite";
const WRITE_EVAL_MODEL_NAME = (
  process.env.AI_WRITE_EVAL_MODEL ??
  process.env.AI_HEAVY_MODEL ??
  MODEL_NAME
).trim();
const OUTPUT_LANGUAGE =
  (process.env.AI_OUTPUT_LANGUAGE ?? "thai").trim().toLowerCase() === "english"
    ? "english"
    : "thai";

function getLanguageInstruction(
  style: "answer" | "feedback" | "writeEvaluation",
): string {
  if (OUTPUT_LANGUAGE === "english") {
    if (style === "writeEvaluation") {
      return "Write in English with medium-to-long detail (6-10 sentences).";
    }
    return style === "answer"
      ? "Respond in English."
      : "Write feedback in English with medium-to-long detail (4-7 sentences).";
  }

  if (style === "writeEvaluation") {
    return "เขียนเป็นภาษาไทยเป็นหลักแบบละเอียดปานกลางถึงยาว (6-10 ประโยค) โดยคงสูตร/คำศัพท์เฉพาะเป็นภาษาเดิมได้";
  }

  return style === "answer"
    ? "ตอบเป็นภาษาไทยเป็นหลัก โดยคงสูตร สัญลักษณ์ และคำศัพท์เฉพาะไว้ตามเดิมได้"
    : "เขียนฟีดแบ็กเป็นภาษาไทยเป็นหลัก (4-7 ประโยค) โดยคงสูตร/คำเฉพาะเป็นภาษาเดิมได้";
}

function buildLearningPrompt(
  prompt: string,
  context: string,
  userContext: string,
): string {
  return [
    "You are a learning assistant.",
    "Use the provided learning content as the primary context.",
    "Use prior learner chat history as secondary context.",
    "If the answer is not clearly in the content, say what is missing and give best-effort guidance.",
    "Keep the explanation clear, practical, and directly related to the learner question.",
    getLanguageInstruction("answer"),
    "",
    "=== Learning Content ===",
    context || "(No learning content provided)",
    "",
    "=== Learner Chat History ===",
    userContext || "(No prior learner chat context provided)",
    "",
    "=== Learner Question ===",
    prompt,
  ].join("\n");
}

function buildFeedbackPrompt(
  question: string,
  correctAnswer: string,
  userAnswer: string,
  evaluationLevel: "correct" | "almost" | "incorrect",
  accuracyPercent: number,
  diagnostics: string,
  feedbackMode: FeedbackMode,
): string {
  const modeInstruction =
    feedbackMode === "full_reflection"
      ? [
          "Mode: full_reflection.",
          "Give deeper reflection and coaching in around 5-8 sentences.",
          "Analyze thinking quality and suggest one concrete improvement plan.",
        ].join("\n")
      : [
          "Mode: quick_check.",
          "Keep feedback short and simple (1-3 sentences).",
          "Focus on one key correction and one tiny next step.",
        ].join("\n");

  return [
    "You are a close friend helping another friend study.",
    getLanguageInstruction("feedback"),
    "Style: casual, warm, a bit playful, like friend-to-friend chat (not formal teacher tone).",
    "Important: You MUST follow the provided evaluation level. Do not override it.",
    "Rules:",
    "- Never label the learner as 'wrong', 'incorrect', or use harsh judgment words.",
    "- If evaluation is correct: celebrate naturally and explain why the thinking is good.",
    "- If evaluation is almost: praise what is already right, then mention what is still missing.",
    "- If evaluation is incorrect: be gentle and frame it as 'almost there' or 'missing some parts', then teach step-by-step.",
    "- Prefer wording like: 'ส่วนนี้ถูกแล้ว (A) แต่ยังขาดอีกนิดที่ (B)'.",
    "- Focus more on the student's answer analysis than simply dumping the final answer.",
    "- If you give the correct answer, do it after explaining what the student already got right.",
    "- End with one actionable next step.",
    modeInstruction,
    "",
    "=== Evaluation (must follow) ===",
    `level: ${evaluationLevel}`,
    `accuracyPercent: ${accuracyPercent}`,
    `diagnostics: ${diagnostics || "(none)"}`,
    "",
    "=== Question ===",
    question || "(No question provided)",
    "",
    "=== Correct Answer ===",
    correctAnswer || "(No correct answer provided)",
    "",
    "=== User Answer ===",
    userAnswer || "(No user answer provided)",
  ].join("\n");
}

function buildWriteEvaluationPrompt(
  question: string,
  guideAnswer: string,
  studentAnswer: string,
  feedbackMode: FeedbackMode,
): string {
  const modeInstruction =
    feedbackMode === "full_reflection"
      ? [
          "Mode: full_reflection.",
          "Respond with deeper reflection in medium-to-long detail (6-10 sentences).",
          "Emphasize self-reflection, reasoning quality, and what to improve next.",
        ].join("\n")
      : [
          "Mode: quick_check.",
          "Respond shortly (2-4 sentences).",
          "Highlight one good point and one key fix only.",
        ].join("\n");

  return [
    "You are a close friend helping another friend study.",
    "Goal: deeply evaluate a student's open-ended answer, not just exact-match checking.",
    getLanguageInstruction("feedback"),
    "Extend detail level to medium-to-long (6-10 sentences).",
    "Style: casual, warm, a bit playful, like friend-to-friend chat (not formal teacher tone).",
    "Important rules:",
    "- The teacher guide answer is only a reference direction, not the only acceptable answer.",
    "- Accept alternative valid reasoning if it is logically sound.",
    "- You can lightly tease/play around a bit, but never insult, shame, or attack the learner.",
    "- Never label the learner as 'wrong', 'incorrect', or use harsh judgment words.",
    "- Start with strengths in the student answer before gaps.",
    "- If there are gaps, frame gently like: 'ส่วนนี้ถูกแล้ว (A) แต่ยังขาดอีกนิดที่ (B)'.",
    "- Explain exactly what is missing and how to improve, step by step.",
    "- Focus more on the student's thinking quality than directly dumping the final answer.",
    "- If you provide a better final answer, give it after feedback and keep it concise.",
    "- End with one actionable next step.",
    "- Output style must be natural long-form conversation, like talking to a real friend.",
    "- Write as 2-4 connected paragraphs, not numbered sections, not bullet lists, and not rigid scorecards.",
    "- Keep it flowing: appreciate what they did well, then gently guide missing points, then suggest how to improve next attempt.",
    modeInstruction,
    "",
    "=== Question ===",
    question || "(No question provided)",
    "",
    "=== Teacher Guide Answer (reference only) ===",
    guideAnswer || "(No guide answer provided)",
    "",
    "=== Student Answer ===",
    studentAnswer || "(No student answer provided)",
  ].join("\n");
}

export const askChat = async (
  req: Request<{}, {}, AskChatBody>,
  res: Response,
): Promise<void> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ message: "Missing GEMINI_API_KEY in server env" });
    return;
  }

  const prompt =
    typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const context =
    typeof req.body?.context === "string" ? req.body.context.trim() : "";
  const userContext =
    typeof req.body?.userContext === "string"
      ? req.body.userContext.trim()
      : "";

  if (!prompt) {
    res.status(400).json({ message: "prompt is required" });
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const finalPrompt = buildLearningPrompt(prompt, context, userContext);
    const result = await generateWithRetry(model, finalPrompt);
    const answer = result.response.text().trim();

    res.status(200).json({ answer });
  } catch (error) {
    console.error("Gemini request failed:", error);
    res.status(500).json({ message: "Gemini request failed" });
  }
};

export const askFeedback = async (
  req: Request<{}, {}, AskFeedbackBody>,
  res: Response,
): Promise<void> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ message: "Missing GEMINI_API_KEY in server env" });
    return;
  }

  const question =
    typeof req.body?.question === "string" ? req.body.question.trim() : "";
  const correctAnswer =
    typeof req.body?.correctAnswer === "string"
      ? req.body.correctAnswer.trim()
      : "";
  const userAnswer =
    typeof req.body?.userAnswer === "string" ? req.body.userAnswer.trim() : "";
  const evaluationLevelRaw =
    typeof req.body?.evaluationLevel === "string"
      ? req.body.evaluationLevel.trim().toLowerCase()
      : "";
  const evaluationLevel: "correct" | "almost" | "incorrect" =
    evaluationLevelRaw === "correct" ||
    evaluationLevelRaw === "almost" ||
    evaluationLevelRaw === "incorrect"
      ? evaluationLevelRaw
      : "incorrect";
  const accuracyPercentRaw =
    typeof req.body?.accuracyPercent === "number"
      ? req.body.accuracyPercent
      : 0;
  const accuracyPercent = Math.max(
    0,
    Math.min(100, Math.round(accuracyPercentRaw)),
  );
  const diagnostics =
    typeof req.body?.diagnostics === "string"
      ? req.body.diagnostics.trim()
      : "";
  const feedbackModeRaw =
    typeof req.body?.feedbackMode === "string"
      ? req.body.feedbackMode.trim().toLowerCase()
      : "";
  const feedbackMode: FeedbackMode =
    feedbackModeRaw === "full_reflection" ? "full_reflection" : "quick_check";

  if (!question) {
    res.status(400).json({ message: "question is required" });
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const prompt = buildFeedbackPrompt(
      question,
      correctAnswer,
      userAnswer,
      evaluationLevel,
      accuracyPercent,
      diagnostics,
      feedbackMode,
    );
    console.log(prompt);
    const result = await generateWithRetry(model, prompt);
    const feedback = result.response.text().trim();
    res.status(200).json({ feedback });
  } catch (error) {
    console.error("Gemini feedback request failed:", error);
    res.status(500).json({ message: "Gemini feedback request failed" });
  }
};

export const askWriteEvaluation = async (
  req: Request<{}, {}, AskWriteEvaluationBody>,
  res: Response,
): Promise<void> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ message: "Missing GEMINI_API_KEY in server env" });
    return;
  }

  const question =
    typeof req.body?.question === "string" ? req.body.question.trim() : "";
  const guideAnswer =
    typeof req.body?.guideAnswer === "string"
      ? req.body.guideAnswer.trim()
      : "";
  const studentAnswer =
    typeof req.body?.studentAnswer === "string"
      ? req.body.studentAnswer.trim()
      : "";
  const feedbackModeRaw =
    typeof req.body?.feedbackMode === "string"
      ? req.body.feedbackMode.trim().toLowerCase()
      : "";
  const feedbackMode: FeedbackMode =
    feedbackModeRaw === "full_reflection" ? "full_reflection" : "quick_check";

  if (!question || !studentAnswer) {
    res
      .status(400)
      .json({ message: "question and studentAnswer are required" });
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: WRITE_EVAL_MODEL_NAME });
    const prompt = buildWriteEvaluationPrompt(
      question,
      guideAnswer,
      studentAnswer,
      feedbackMode,
    );
    console.log(prompt);
    const result = await generateWithRetry(model, prompt);
    const feedback = result.response.text().trim();
    res.status(200).json({ feedback });
  } catch (error) {
    console.error("Gemini write evaluation request failed:", error);
    res.status(500).json({ message: "Gemini write evaluation request failed" });
  }
};
