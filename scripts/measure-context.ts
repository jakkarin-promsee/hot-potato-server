/**
 * Tier 0.D context measurement — prints the real sizes of everything the
 * tutor sends to Gemini for one lesson. Read-only against the DB.
 *
 * Usage:  npx ts-node scripts/measure-context.ts [contentId]
 * Defaults to the test lesson. Numbers are logged in ../asking-flow.md.
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { getLessonContext } from "../src/services/lessonContext.service";
import {
  buildFeedbackUserTurn,
  buildSystemInstruction,
} from "../src/services/tutor/persona";

const CONTENT_ID = process.argv[2] || "69e39d0b60d467bd515a4945";

// Very rough Gemini token estimate for mixed Thai/English (~3 chars/token).
const tok = (chars: number) => Math.round(chars / 3);

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI not set");
  // Same dbName the app uses (see src/config/db.ts)
  await mongoose.connect(process.env.MONGO_URI, { dbName: "HotPotato" });

  const lesson = await getLessonContext(CONTENT_ID);
  if (!lesson) throw new Error(`lesson ${CONTENT_ID} not found`);

  const sys = buildSystemInstruction({ lesson });
  const sysNoLesson = buildSystemInstruction({
    lesson: { ...lesson, text: "", questions: [] },
  });

  const q = lesson.questions[0];
  const feedbackTurn = buildFeedbackUserTurn({
    question: q?.question ?? "(no question)",
    guideAnswer: q?.guideAnswer ?? "",
    level: "almost",
    accuracyPercent: 50,
    feedbackMode: "quick_check",
    studentAnswer: "คำตอบตัวอย่างของนักเรียนยาวประมาณหนึ่งประโยค",
    diagnostics: "missedCorrect=ตัวอย่าง; wrongSelected=(none)",
  });

  const rows = [
    ["lesson title", lesson.title],
    ["lesson text (chars)", lesson.text.length],
    ["questions in lesson", lesson.questions.length],
    ["systemInstruction total (chars)", `${sys.length} (~${tok(sys.length)} tok)`],
    [
      "  └ persona boilerplate only",
      `${sysNoLesson.length} (~${tok(sysNoLesson.length)} tok)`,
    ],
    [
      "  └ lesson + questions share",
      `${sys.length - sysNoLesson.length} (~${tok(sys.length - sysNoLesson.length)} tok)`,
    ],
    ["feedback user turn, sample (chars)", feedbackTurn.length],
    ["history cap, logged-in", "50 msgs/session (ChatSession pre-save hook)"],
    ["history cap, anonymous", "30 entries × ≤2000 chars (clientThread)"],
  ];
  for (const [k, v] of rows) console.log(`${String(k).padEnd(36)} ${v}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
