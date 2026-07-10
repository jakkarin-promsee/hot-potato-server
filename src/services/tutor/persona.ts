import type { LessonContext } from "../lessonContext.service";

const OUTPUT_LANGUAGE =
  (process.env.AI_OUTPUT_LANGUAGE ?? "thai").trim().toLowerCase() === "english"
    ? "english"
    : "thai";

function languageRule(): string {
  if (OUTPUT_LANGUAGE === "english") {
    return "Respond in English. Keep formulas and technical terms as-is.";
  }
  return "ตอบเป็นภาษาไทยเป็นหลัก โดยคงสูตร สัญลักษณ์ และคำศัพท์เฉพาะไว้ตามเดิมได้";
}

export function buildSystemInstruction(opts: {
  lesson: LessonContext;
  memoryDigest?: string;
  teacherNote?: string;
}): string {
  const { lesson } = opts;
  const questionLines = lesson.questions.map((q) => {
    const guide = q.guideAnswer ? q.guideAnswer : "(ไม่มี)";
    return `- [${q.blockId}] (${q.kind}) ${q.question}\n  แนวคำตอบครู: ${guide}`;
  });

  return [
    "You are a warm, close-friend study buddy helping a student learn.",
    languageRule(),
    "Style: casual, warm, a bit playful — friend-to-friend, not formal teacher tone.",
    "Rules:",
    "- Never label the learner as 'wrong', 'incorrect', or use harsh judgment words.",
    "- Admire their thinking first, then add depth gently.",
    "- End with one actionable next step when coaching.",
    "- Guide answers from the teacher are reference directions only — never reveal them verbatim unless the student already answered.",
    "",
    `=== บทเรียน: ${lesson.title} ===`,
    lesson.text || "(ไม่มีเนื้อหา)",
    "",
    "=== คำถามในบทเรียน ===",
    questionLines.length ? questionLines.join("\n") : "(ไม่มีคำถาม)",
    "",
    "แนวคำตอบของครูเป็นแนวทางอ้างอิงเท่านั้น ห้ามเปิดเผยคำตอบเต็มให้นักเรียนที่ยังไม่ได้ตอบ",
  ].join("\n");
}

export function parseTutorReply(raw: string): {
  reply: string;
  suggestions: string[];
} {
  return { reply: raw, suggestions: [] };
}

export function buildFeedbackUserTurn(opts: {
  question: string;
  guideAnswer: string;
  level: "correct" | "almost" | "incorrect" | "ai_judge";
  accuracyPercent: number;
  feedbackMode: "quick_check" | "full_reflection";
  studentAnswer: string;
}): string {
  const evaluationLine =
    opts.level === "ai_judge"
      ? "ให้เธอประเมินเองอย่างใจดี เน้นคุณภาพการคิด"
      : `level=${opts.level}, accuracy=${opts.accuracyPercent}% — ต้องยึดตามนี้`;

  return [
    "[งานของเธอตอนนี้: ให้ฟีดแบ็กคำตอบของเพื่อน]",
    `คำถามจากคุณครู: ${opts.question}`,
    `แนวคำตอบของคุณครู (ใช้เป็นแนวทาง ไม่ใช่คำตอบเดียวที่ถูก): ${opts.guideAnswer || "(ไม่มี)"}`,
    `ผลการตรวจ: ${evaluationLine}`,
    `โหมดความยาว: ${opts.feedbackMode}`,
    `คำตอบของเพื่อน: ${opts.studentAnswer}`,
  ].join("\n");
}
