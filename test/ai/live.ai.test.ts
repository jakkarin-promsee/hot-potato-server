import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { loadLessonFixture } from "../helpers/seed";

// Gated: costs real Gemini tokens. Runs only under `npm run test:ai` with a
// real key present (never with the placeholder key from test/setup.ts).
const LIVE =
  process.env.RUN_AI_TESTS === "true" &&
  !!process.env.GEMINI_API_KEY &&
  process.env.GEMINI_API_KEY !== "test-gemini-key";
const describeLive = LIVE ? describe : describe.skip;

const THAI = /[\u0E00-\u0E7F]/;

// Pull the plain Thai text out of the fixture's tiptap_json so the live model
// gets a real lesson as context (a stand-in until the Phase 1 serializer lands).
function fixtureText(): string {
  const fixture = loadLessonFixture();
  const doc = JSON.parse(String(fixture.tiptap_json));
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") out.push(node.text);
    if (typeof node?.attrs?.question === "string") out.push(node.attrs.question);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  return out.join("\n");
}

describeLive("live Gemini smoke tests", () => {
  it("1. /chat/ask returns a non-empty Thai answer grounded in the lesson", async () => {
    const context = fixtureText().slice(0, 4000);
    const res = await request(app).post("/api/chat/ask").send({
      prompt: "ช่วยสรุปเนื้อหานี้ให้หน่อย",
      context,
    });
    expect(res.status).toBe(200);
    expect(res.body.answer.length).toBeGreaterThan(20);
    expect(THAI.test(res.body.answer)).toBe(true);
  });

  it("2. /chat/write-evaluate returns non-empty Thai feedback", async () => {
    const res = await request(app).post("/api/chat/write-evaluate").send({
      question: "อธิบายว่าทำไมพืชจึงสำคัญต่อสิ่งมีชีวิตอื่น",
      guideAnswer: "พืชผลิตออกซิเจนและเป็นผู้ผลิตอาหารในห่วงโซ่อาหาร",
      studentAnswer: "พืชให้ออกซิเจนกับเรา",
    });
    expect(res.status).toBe(200);
    expect(res.body.feedback.length).toBeGreaterThan(20);
    expect(THAI.test(res.body.feedback)).toBe(true);
  });
});
