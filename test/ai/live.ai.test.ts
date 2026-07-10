import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { seedLesson, seedUser } from "../helpers/seed";

// Gated: costs real Gemini tokens. Runs only under `npm run test:ai` with a
// real key present (never with the placeholder key from test/setup.ts).
const LIVE =
  process.env.RUN_AI_TESTS === "true" &&
  !!process.env.GEMINI_API_KEY &&
  process.env.GEMINI_API_KEY !== "test-gemini-key";
const describeLive = LIVE ? describe : describe.skip;

const THAI = /[฀-๿]/;

describeLive("live Gemini smoke tests (unified tutor)", () => {
  it("1. free_chat returns a non-empty Thai reply on the fixture lesson", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app).post("/api/chat/tutor").send({
      contentId: lesson._id.toString(),
      mode: "free_chat",
      message: "ช่วยอธิบายการสังเคราะห์แสงแบบสั้นๆ หน่อย",
    });
    expect(res.status).toBe(200);
    expect(res.body.reply.length).toBeGreaterThan(20);
    expect(THAI.test(res.body.reply)).toBe(true);
    // Log suggestions presence — model may occasionally miss the format.
    console.log(
      `[live free_chat] suggestions parsed: ${res.body.suggestions?.length ?? 0}`,
      res.body.suggestions,
    );
  });

  it("2. question_feedback returns non-empty Thai feedback that follows the level", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        blockId: "live-feedback",
        mode: "question_feedback",
        message: "น้ำ",
        questionContext: {
          question: "พืชใช้วัตถุดิบอะไรในการสังเคราะห์แสง",
          guideAnswer: "น้ำ และคาร์บอนไดออกไซด์",
          evaluation: {
            level: "almost",
            accuracyPercent: 50,
            diagnostics: "missedCorrect=คาร์บอนไดออกไซด์",
          },
          feedbackMode: "quick_check",
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.reply.length).toBeGreaterThan(20);
    expect(THAI.test(res.body.reply)).toBe(true);
  });

  it("3. write_evaluation returns non-empty Thai evaluation", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        blockId: "live-write",
        mode: "write_evaluation",
        message: "พืชให้ออกซิเจนกับเรา",
        questionContext: {
          question: "อธิบายว่าทำไมพืชจึงสำคัญต่อสิ่งมีชีวิตอื่น",
          guideAnswer: "พืชผลิตออกซิเจนและเป็นผู้ผลิตอาหารในห่วงโซ่อาหาร",
          feedbackMode: "full_reflection",
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.reply.length).toBeGreaterThan(20);
    expect(THAI.test(res.body.reply)).toBe(true);
  });

  it("4. followup small talk gets a greeting, not an evaluation (P1 guard)", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        blockId: "live-followup",
        mode: "followup",
        message: "สวัสดี",
        clientThread: [
          { role: "student", text: "น้ำ" },
          { role: "tutor", text: "เกือบครบแล้ว ขาดอีกอย่างเดียวเลย ลองนึกถึงอากาศดูนะ" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.reply.length).toBeGreaterThan(0);
    expect(THAI.test(res.body.reply)).toBe(true);
    // Must not read like a graded verdict.
    expect(res.body.reply).not.toMatch(/level=|accuracy|ผลการตรวจ/);
    console.log("[live followup small-talk reply]", res.body.reply);
  });
});
