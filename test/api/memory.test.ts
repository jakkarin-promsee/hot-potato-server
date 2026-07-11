import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { Types } from "mongoose";

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(async () => ({ text: "MOCK_AI_REPLY" })),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
  Type: {
    OBJECT: "OBJECT",
    BOOLEAN: "BOOLEAN",
    ARRAY: "ARRAY",
    STRING: "STRING",
  },
}));

import app from "../../src/app";
import { StudentMemory } from "../../src/models/student_memory.model";
import { clearLessonContextCache } from "../../src/services/lessonContext.service";
import { runMemoryUpdate } from "../../src/services/tutor/memory";
import { seedLesson, seedUser } from "../helpers/seed";

interface GenerateContentArg {
  model?: string;
  contents?: unknown;
  config?: { systemInstruction?: string; responseMimeType?: string };
}

function isMemoryCall(call: GenerateContentArg | undefined): boolean {
  return call?.config?.responseMimeType === "application/json";
}

function memoryCalls(): GenerateContentArg[] {
  return mockGenerateContent.mock.calls
    .map((c) => c[0] as GenerateContentArg)
    .filter(isMemoryCall);
}

function tutorCalls(): GenerateContentArg[] {
  return mockGenerateContent.mock.calls
    .map((c) => c[0] as GenerateContentArg)
    .filter((c) => !isMemoryCall(c));
}

function capturedSystemInstruction(): string {
  const call = tutorCalls().at(-1);
  return call?.config?.systemInstruction ?? "";
}

function mockMemoryJson(payload: Record<string, unknown>) {
  mockGenerateContent.mockImplementation(async (arg: GenerateContentArg) => {
    if (isMemoryCall(arg)) {
      return { text: JSON.stringify(payload) };
    }
    return { text: "MOCK_AI_REPLY" };
  });
}

beforeEach(() => {
  mockGenerateContent.mockClear();
  mockGenerateContent.mockResolvedValue({ text: "MOCK_AI_REPLY" });
  clearLessonContextCache();
});

describe("runMemoryUpdate (direct)", () => {
  it("1. changed: true → StudentMemory doc upserted with capped fields", async () => {
    mockMemoryJson({
      changed: true,
      interests: ["ฟุตบอล"],
      strengths: ["คิดเป็น"],
      growth_areas: ["เศษส่วน"],
      preferences: ["สั้นๆ"],
      topic_summary: "เรียนการสังเคราะห์แสง",
    });
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    await runMemoryUpdate({
      userId: user._id,
      contentId: lesson._id,
      lessonTitle: lesson.title,
      recentTurns: [
        { role: "student", text: "ชอบฟุตบอล" },
        { role: "tutor", text: "เจ๋งเลย" },
      ],
    });
    const mem = await StudentMemory.findOne({ user_id: user._id });
    expect(mem?.interests).toEqual(["ฟุตบอล"]);
    expect(mem?.strengths).toEqual(["คิดเป็น"]);
    expect(mem?.growth_areas).toEqual(["เศษส่วน"]);
    expect(mem?.preferences).toEqual(["สั้นๆ"]);
    expect(mem?.recent_topics).toHaveLength(1);
    expect(mem?.recent_topics[0].summary).toBe("เรียนการสังเคราะห์แสง");
  });

  it("2. changed: false → no doc created", async () => {
    mockMemoryJson({ changed: false });
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    await runMemoryUpdate({
      userId: user._id,
      contentId: lesson._id,
      lessonTitle: lesson.title,
      recentTurns: [{ role: "student", text: "สวัสดี" }],
    });
    expect(await StudentMemory.countDocuments()).toBe(0);
  });

  it("3. oversized model output → stored with caps enforced", async () => {
    const long = "x".repeat(300);
    mockMemoryJson({
      changed: true,
      interests: Array.from({ length: 15 }, (_, i) => `${long}-${i}`),
      topic_summary: "ok",
    });
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    await runMemoryUpdate({
      userId: user._id,
      contentId: lesson._id,
      lessonTitle: lesson.title,
      recentTurns: [{ role: "student", text: "test" }],
    });
    const mem = await StudentMemory.findOne({ user_id: user._id });
    expect(mem?.interests).toHaveLength(10);
    for (const item of mem?.interests ?? []) {
      expect(item.length).toBeLessThanOrEqual(120);
    }
  });

  it("4. changed: true with omitted lists preserves existing fields", async () => {
    mockMemoryJson({
      changed: true,
      topic_summary: "ถามเรื่องแสง",
    });
    const { user } = await seedUser();
    await StudentMemory.create({
      user_id: user._id,
      interests: ["ฟุตบอล"],
      strengths: ["คิดเป็น"],
      growth_areas: [],
      preferences: [],
      recent_topics: [],
    });
    const lesson = await seedLesson(user._id);
    await runMemoryUpdate({
      userId: user._id,
      contentId: lesson._id,
      lessonTitle: lesson.title,
      recentTurns: [{ role: "student", text: "test" }],
    });
    const mem = await StudentMemory.findOne({ user_id: user._id });
    expect(mem?.interests).toEqual(["ฟุตบอล"]);
    expect(mem?.strengths).toEqual(["คิดเป็น"]);
    expect(mem?.recent_topics[0].summary).toBe("ถามเรื่องแสง");
  });

  it("5. model throws → resolves without throwing; no doc", async () => {
    mockGenerateContent.mockRejectedValue(new Error("boom"));
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    await expect(
      runMemoryUpdate({
        userId: user._id,
        contentId: lesson._id,
        lessonTitle: lesson.title,
        recentTurns: [{ role: "student", text: "test" }],
      }),
    ).resolves.toBeUndefined();
    expect(await StudentMemory.countDocuments()).toBe(0);
  });
});

async function tutorTurn(
  token: string,
  contentId: string,
  message: string,
  blockId = "mem-block",
) {
  return request(app)
    .post("/api/chat/tutor")
    .set("Authorization", `Bearer ${token}`)
    .send({
      contentId,
      blockId,
      mode: "free_chat",
      message,
    });
}

describe("POST /api/chat/tutor memory integration (feature enabled)", () => {
  // Memory is shelved by default (AI_MEMORY_ENABLED off); these tests exercise
  // the feature as it behaves when a deploy turns it back on.
  let prevFlag: string | undefined;
  beforeEach(() => {
    prevFlag = process.env.AI_MEMORY_ENABLED;
    process.env.AI_MEMORY_ENABLED = "true";
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env.AI_MEMORY_ENABLED;
    else process.env.AI_MEMORY_ENABLED = prevFlag;
  });

  it("6. logged-in turn #3 triggers memory update", async () => {
    mockMemoryJson({
      changed: true,
      interests: ["ฟุตบอล"],
      topic_summary: "ถามเรื่องแสง",
    });
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const contentId = lesson._id.toString();
    await tutorTurn(token, contentId, "เทิร์น 1");
    await tutorTurn(token, contentId, "เทิร์น 2");
    await tutorTurn(token, contentId, "เทิร์น 3");
    await vi.waitFor(async () => {
      const mem = await StudentMemory.findOne({ user_id: user._id });
      expect(mem?.interests).toEqual(["ฟุตบอล"]);
    });
  });

  it("7. turns #1 and #2 do not trigger memory update", async () => {
    mockMemoryJson({
      changed: true,
      interests: ["should-not-save"],
    });
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const contentId = lesson._id.toString();
    await tutorTurn(token, contentId, "เทิร์น 1");
    await tutorTurn(token, contentId, "เทิร์น 2");
    expect(memoryCalls()).toHaveLength(0);
    expect(await StudentMemory.countDocuments()).toBe(0);
  });

  it("8. anonymous tutor turns never create memory", async () => {
    mockMemoryJson({
      changed: true,
      interests: ["anon"],
    });
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    for (let i = 1; i <= 3; i++) {
      await request(app)
        .post("/api/chat/tutor")
        .send({
          contentId: lesson._id.toString(),
          mode: "free_chat",
          message: `anon-${i}`,
        });
    }
    expect(memoryCalls()).toHaveLength(0);
    expect(await StudentMemory.countDocuments()).toBe(0);
  });

  it("9. existing memory → systemInstruction contains memory header and value", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await StudentMemory.create({
      user_id: user._id,
      interests: ["ฟุตบอล"],
      strengths: [],
      growth_areas: [],
      preferences: [],
      recent_topics: [],
    });
    await tutorTurn(token, lesson._id.toString(), "สวัสดี");
    const sys = capturedSystemInstruction();
    expect(sys).toContain("== สิ่งที่รู้เกี่ยวกับเพื่อนคนนี้ ==");
    expect(sys).toContain("ฟุตบอล");
  });

  it("10. no memory → systemInstruction omits memory header", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await tutorTurn(token, lesson._id.toString(), "สวัสดี");
    const sys = capturedSystemInstruction();
    expect(sys).not.toContain("== สิ่งที่รู้เกี่ยวกับเพื่อนคนนี้ ==");
  });
});

describe("memory shelved by default (AI_MEMORY_ENABLED unset)", () => {
  // Force the default off state, independent of any local .env, so the
  // controller neither schedules an update nor injects a digest.
  let prevFlag: string | undefined;
  beforeEach(() => {
    prevFlag = process.env.AI_MEMORY_ENABLED;
    delete process.env.AI_MEMORY_ENABLED;
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env.AI_MEMORY_ENABLED;
    else process.env.AI_MEMORY_ENABLED = prevFlag;
  });

  it("13. three logged-in turns trigger no memory update and create no doc", async () => {
    mockMemoryJson({ changed: true, interests: ["should-not-save"] });
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const contentId = lesson._id.toString();
    await tutorTurn(token, contentId, "เทิร์น 1");
    await tutorTurn(token, contentId, "เทิร์น 2");
    await tutorTurn(token, contentId, "เทิร์น 3");
    expect(memoryCalls()).toHaveLength(0);
    expect(await StudentMemory.countDocuments()).toBe(0);
  });

  it("14. existing memory doc is NOT injected into the system instruction", async () => {
    // A distinctive interest that does not otherwise appear in the prompt
    // (avoid loanword-rule example words like "ฟุตบอล").
    const uniqueInterest = "เลี้ยงปลากัด";
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await StudentMemory.create({
      user_id: user._id,
      interests: [uniqueInterest],
      strengths: [],
      growth_areas: [],
      preferences: [],
      recent_topics: [],
    });
    await tutorTurn(token, lesson._id.toString(), "สวัสดี");
    const sys = capturedSystemInstruction();
    expect(sys).not.toContain("== สิ่งที่รู้เกี่ยวกับเพื่อนคนนี้ ==");
    expect(sys).not.toContain(uniqueInterest);
  });
});

describe("GET/DELETE /api/chat/memory", () => {
  it("11. GET without token → 401 TOKEN_MISSING", async () => {
    const res = await request(app).get("/api/chat/memory");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_MISSING");
  });

  it("12. DELETE then GET → memory gone", async () => {
    const { user, token } = await seedUser();
    await StudentMemory.create({
      user_id: user._id,
      interests: ["ฟุตบอล"],
      strengths: [],
      growth_areas: [],
      preferences: [],
      recent_topics: [],
    });
    const del = await request(app)
      .delete("/api/chat/memory")
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.message).toBe("Memory cleared");

    const get = await request(app)
      .get("/api/chat/memory")
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body).toEqual({});
  });
});
