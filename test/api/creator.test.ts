import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { Types } from "mongoose";

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(async () => ({ text: "{}" })),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

import app from "../../src/app";
import { getFastModel, getTutorModel } from "../../src/services/tutor/models";
import { callTutorModel } from "../../src/services/tutor/genaiClient";
import { clearLessonContextCache } from "../../src/services/lessonContext.service";
import { protect } from "../../src/middlewares/auth.middleware";
import { createChatRateLimiter } from "../../src/middlewares/rateLimit.middleware";
import { seedLesson, seedUser } from "../helpers/seed";

interface GenerateContentArg {
  model?: string;
  contents?: { role: string; parts: { text: string }[] }[];
  config?: { systemInstruction?: string; responseMimeType?: string };
}

function capturedCall(): GenerateContentArg | undefined {
  return mockGenerateContent.mock.calls.at(-1)?.[0] as
    | GenerateContentArg
    | undefined;
}

function capturedUserMessage(): string {
  const contents = capturedCall()?.contents ?? [];
  return contents.at(-1)?.parts[0]?.text ?? "";
}

const VALID_CHOICE_JSON = JSON.stringify({
  questions: [
    {
      type: "choice",
      question: "พืชใช้อะไรเป็นแหล่งพลังงาน?",
      choices: [
        { text: "แสงอาทิตย์", correct: true },
        { text: "เสียง", correct: false },
        { text: "ความมืด", correct: false },
      ],
    },
  ],
});

async function seedOwnerAndLesson() {
  const owner = await seedUser();
  const lesson = await seedLesson(owner.user._id);
  return { owner, lesson, contentId: lesson._id.toString() };
}

beforeEach(() => {
  mockGenerateContent.mockClear();
  mockGenerateContent.mockResolvedValue({ text: "{}" });
  clearLessonContextCache();
});

describe("POST /api/creator/assist — guards", () => {
  it("401 without a token", async () => {
    const { contentId } = await seedOwnerAndLesson();
    const res = await request(app)
      .post("/api/creator/assist")
      .send({ contentId, action: "lesson_meta" });
    expect(res.status).toBe(401);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("403 for a logged-in non-owner", async () => {
    const { contentId } = await seedOwnerAndLesson();
    const stranger = await seedUser();
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${stranger.token}`)
      .send({ contentId, action: "lesson_meta" });
    expect(res.status).toBe(403);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("collaborator passes the ownership check", async () => {
    const owner = await seedUser();
    const collab = await seedUser();
    const lesson = await seedLesson(owner.user._id, {
      collaborators: [collab.user._id],
    });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "การสังเคราะห์แสง",
        description: "พืชสร้างอาหารยังไง",
        topics: ["ชีววิทยา"],
      }),
    });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${collab.token}`)
      .send({ contentId: lesson._id.toString(), action: "lesson_meta" });
    expect(res.status).toBe(200);
    expect(res.body.result.title).toBe("การสังเคราะห์แสง");
  });

  it("404 for a valid-but-unknown contentId, 400 for a malformed one", async () => {
    const { owner } = await seedOwnerAndLesson();
    const missing = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ contentId: new Types.ObjectId().toString(), action: "critic" });
    expect(missing.status).toBe(404);

    const malformed = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ contentId: "not-an-id", action: "critic" });
    expect(malformed.status).toBe(400);
  });

  it("400 for an unknown action", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ contentId, action: "write_my_thesis" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("action");
  });
});

describe("POST /api/creator/assist — actions", () => {
  it("formula_latex: fast model, JSON mode, result shape", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ latex: "s = ut + \\frac{1}{2}at^2" }),
    });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "formula_latex",
        payload: {
          formulaText: "s = ut + 1/2at^2",
          description: "สมการการเคลื่อนที่",
          usage: "คำนวณระยะทาง",
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ latex: "s = ut + \\frac{1}{2}at^2" });
    expect(capturedCall()?.model).toBe(getFastModel());
    expect(capturedCall()?.config?.responseMimeType).toBe("application/json");
    expect(capturedUserMessage()).toContain("สมการการเคลื่อนที่");
  });

  it("formula_latex: 400 without formulaText", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ contentId, action: "formula_latex", payload: {} });
    expect(res.status).toBe(400);
  });

  it("proofread: fast model, plain output wrapped by the server, no JSON mime", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({ text: "ข้อความที่แก้คำผิดแล้ว" });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "proofread",
        payload: { markdown: "ข้อความมีคำผิk", preset: "proofread" },
      });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ markdown: "ข้อความที่แก้คำผิดแล้ว" });
    expect(capturedCall()?.model).toBe(getFastModel());
    expect(capturedCall()?.config?.responseMimeType).toBeUndefined();
  });

  it("proofread: reading_level requires gradeLevel; bad preset 400", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    const noGrade = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "proofread",
        payload: { markdown: "x", preset: "reading_level" },
      });
    expect(noGrade.status).toBe(400);

    const badPreset = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "proofread",
        payload: { markdown: "x", preset: "rewrite_everything" },
      });
    expect(badPreset.status).toBe(400);
  });

  it("generate_questions scope=lesson: tutor model + lesson text + existing questions injected", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({ text: VALID_CHOICE_JSON });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "generate_questions",
        payload: { scope: "lesson", types: ["choice", "write"], count: 3 },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.questions).toHaveLength(1);
    expect(res.body.result.questions[0].type).toBe("choice");
    expect(capturedCall()?.model).toBe(getTutorModel());
    const message = capturedUserMessage();
    // Lesson text from the fixture (scope=lesson)
    expect(message).toContain("การสังเคราะห์แสงคือกระบวนการที่พืชสร้างอาหาร");
    // Existing questions + anti-duplicate instruction (always injected)
    expect(message).toContain("คำถามที่มีอยู่แล้วในบทเรียน");
    expect(message).toContain("อย่าสร้างคำถามซ้ำ");
  });

  it("generate_questions scope=selection uses the selection, not lesson text", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({ text: VALID_CHOICE_JSON });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "generate_questions",
        payload: {
          scope: "selection",
          selectionMarkdown: "แรงเสียดทานเกิดจากผิวสัมผัส",
          types: ["write"],
          count: 2,
        },
      });
    expect(res.status).toBe(200);
    const message = capturedUserMessage();
    expect(message).toContain("แรงเสียดทานเกิดจากผิวสัมผัส");
    expect(message).not.toContain("การสังเคราะห์แสงคือกระบวนการที่พืชสร้างอาหาร");
  });

  it("generate_questions: 400 on bad types/count", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    const badTypes = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "generate_questions",
        payload: { scope: "lesson", types: ["essay"], count: 3 },
      });
    expect(badTypes.status).toBe(400);

    const badCount = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "generate_questions",
        payload: { scope: "lesson", types: ["choice"], count: 25 },
      });
    expect(badCount.status).toBe(400);
  });

  it("guide_answer: tutor model, plain text clamped into result", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({
      text: "แนวเฉลย: พืชใช้คลอโรฟิลล์จับพลังงานแสง",
    });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "guide_answer",
        payload: { question: "พืชจับพลังงานแสงได้อย่างไร?" },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.guideAnswer).toContain("คลอโรฟิลล์");
    expect(capturedCall()?.model).toBe(getTutorModel());
  });

  it("distractors: fast model, exactly 3", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ distractors: ["แสงจันทร์", "ไฟฟ้า", "เสียง"] }),
    });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "distractors",
        payload: { question: "พืชใช้อะไร?", correctText: "แสงอาทิตย์" },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.distractors).toHaveLength(3);
    expect(capturedCall()?.model).toBe(getFastModel());
  });

  it("outline + draft_section: tutor model, markdown results", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({
      text: "## บทนำ\n*เกริ่นเรื่องแรง*",
    });
    const outline = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "outline",
        payload: { topic: "แรงและการเคลื่อนที่", gradeLevel: "ม.2" },
      });
    expect(outline.status).toBe(200);
    expect(outline.body.result.outlineMarkdown).toContain("## บทนำ");
    expect(capturedCall()?.model).toBe(getTutorModel());

    mockGenerateContent.mockResolvedValue({ text: "เนื้อหาของหัวข้อนี้..." });
    const draft = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "draft_section",
        payload: { heading: "บทนำ" },
      });
    expect(draft.status).toBe(200);
    expect(draft.body.result.markdown).toBe("เนื้อหาของหัวข้อนี้...");
    // draft_section grounds on current lesson text
    expect(capturedUserMessage()).toContain("เนื้อหาบทเรียนปัจจุบัน");
  });

  it("import_structure: tutor model, markdown + validated questions", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        markdown: "## หัวข้อจากชีทเดิม",
        suggestedQuestions: [
          {
            type: "write",
            question: "อธิบายแนวคิดหลัก",
            guideAnswer: "ประเด็นสำคัญคือ...",
          },
          { type: "choice", question: "ข้อไหนถูก?", choices: [] },
        ],
      }),
    });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "import_structure",
        payload: { rawText: "เนื้อหาชีทเก่าของครู..." },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.markdown).toBe("## หัวข้อจากชีทเดิม");
    // Malformed choice question dropped, valid write question kept
    expect(res.body.result.suggestedQuestions).toHaveLength(1);
    expect(capturedCall()?.model).toBe(getTutorModel());
  });

  it("critic: tutor model; question-count checklist item is deterministic", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        summary: "บทเรียนอบอุ่นและครบถ้วนมาก",
        issues: [],
        // AI wrongly claims the lesson has < 3 questions — server must override
        checklist: [
          { item: "มีคำนำ/เกริ่น", pass: true },
          { item: "มีคำถามอย่างน้อย 3 ข้อ", pass: false },
        ],
      }),
    });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ contentId, action: "critic" });
    expect(res.status).toBe(200);
    expect(capturedCall()?.model).toBe(getTutorModel());
    // Fixture lesson has 4 gradeable questions → deterministic pass=true
    const item = res.body.result.checklist.find(
      (c: { item: string }) => c.item === "มีคำถามอย่างน้อย 3 ข้อ",
    );
    expect(item.pass).toBe(true);
  });

  it("agent_settings_suggest: tutor model; current settings in the prompt", async () => {
    const owner = await seedUser();
    const lesson = await seedLesson(owner.user._id, {
      agent_settings: {
        persona_note: "ครูใจดีสายฟิสิกส์",
        allow_direct_answers: false,
        scope: "lesson_plus_general",
        custom_guidelines: "",
      },
    });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        persona_note: "ครูใจดีสายฟิสิกส์ ชวนตั้งคำถาม",
        custom_guidelines: "อย่าเฉลยโจทย์คำนวณตรงๆ",
        scope: "lesson_plus_general",
        allow_direct_answers: false,
        reason: "เน้นให้เด็กลองคิดก่อน",
      }),
    });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId: lesson._id.toString(),
        action: "agent_settings_suggest",
      });
    expect(res.status).toBe(200);
    expect(res.body.result.scope).toBe("lesson_plus_general");
    expect(res.body.result.reason).toContain("คิดก่อน");
    expect(capturedCall()?.model).toBe(getTutorModel());
    expect(capturedCall()?.config?.systemInstruction).toContain(
      "ครูใจดีสายฟิสิกส์",
    );
  });
});

describe("POST /api/creator/assist — JSON robustness", () => {
  it("fenced ```json output still parses", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({
      text: '```json\n{"latex": "E=mc^2"}\n```',
    });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "formula_latex",
        payload: { formulaText: "E=mc^2" },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.latex).toBe("E=mc^2");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("garbage → exactly one retry → 500 AI_UNAVAILABLE on second garbage", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent.mockResolvedValue({ text: "ขอโทษ ฉันสับสน" });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "formula_latex",
        payload: { formulaText: "E=mc^2" },
      });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("AI_UNAVAILABLE");
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("garbage then valid → succeeds on the retry", async () => {
    const { owner, contentId } = await seedOwnerAndLesson();
    mockGenerateContent
      .mockResolvedValueOnce({ text: "อุ๊ปส์" })
      .mockResolvedValueOnce({ text: '{"latex": "a^2+b^2=c^2"}' });
    const res = await request(app)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        contentId,
        action: "formula_latex",
        payload: { formulaText: "a2+b2=c2" },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.latex).toBe("a^2+b^2=c^2");
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });
});

describe("callTutorModel responseMimeType extension (regression)", () => {
  it("omitting responseMimeType leaves config exactly as before", async () => {
    mockGenerateContent.mockResolvedValue({ text: "ok" });
    await callTutorModel({
      model: "test-model",
      systemInstruction: "sys",
      history: [],
      message: "hi",
    });
    const config = capturedCall()?.config as Record<string, unknown>;
    expect(Object.keys(config)).toEqual(["systemInstruction"]);
    expect(config.systemInstruction).toBe("sys");
  });

  it("setting responseMimeType passes it through to config", async () => {
    mockGenerateContent.mockResolvedValue({ text: "{}" });
    await callTutorModel({
      model: "test-model",
      systemInstruction: "sys",
      history: [],
      message: "hi",
      responseMimeType: "application/json",
    });
    expect(capturedCall()?.config?.responseMimeType).toBe("application/json");
  });
});

describe("creator route rate limiting", () => {
  let miniApp: express.Express;
  let token: string;

  beforeAll(async () => {
    process.env.AI_RATELIMIT_PER_10MIN = "3";
    const seeded = await seedUser();
    token = seeded.token;
    miniApp = express();
    miniApp.set("trust proxy", 1);
    miniApp.use(express.json());
    const handler = vi.fn((_req, res) => res.status(200).json({ ok: true }));
    // Same guard composition as creator.routes.ts
    miniApp.post(
      "/api/creator/assist",
      protect,
      ...createChatRateLimiter(),
      handler,
    );
  });

  it("429 after the per-user limit", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(miniApp)
        .post("/api/creator/assist")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);
    }
    const blocked = await request(miniApp)
      .post("/api/creator/assist")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(blocked.status).toBe(429);
  });
});
