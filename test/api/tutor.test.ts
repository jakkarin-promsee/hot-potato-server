import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { Types } from "mongoose";

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(async () => ({ text: "MOCK_AI_REPLY" })),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

import { getTutorModel } from "../../src/services/tutor/models";
import app from "../../src/app";
import {
  ChatSession,
  MAX_SESSION_MESSAGES,
} from "../../src/models/chat_session.model";
import { StudentMemory } from "../../src/models/student_memory.model";
import { clearLessonContextCache } from "../../src/services/lessonContext.service";
import { seedLesson, seedUser } from "../helpers/seed";

interface GenerateContentArg {
  model?: string;
  contents?: { role: string; parts: { text: string }[] }[];
  config?: { systemInstruction?: string };
}

function capturedCall(): GenerateContentArg | undefined {
  return mockGenerateContent.mock.calls.at(-1)?.[0] as
    | GenerateContentArg
    | undefined;
}

function capturedModel(): string {
  return capturedCall()?.model ?? "";
}

function capturedContents(): GenerateContentArg["contents"] {
  return capturedCall()?.contents ?? [];
}

function capturedSystemInstruction(): string {
  return capturedCall()?.config?.systemInstruction ?? "";
}

beforeEach(() => {
  mockGenerateContent.mockClear();
  mockGenerateContent.mockResolvedValue({ text: "MOCK_AI_REPLY" });
  clearLessonContextCache();
});

describe("POST /api/chat/tutor", () => {
  it("1. missing/invalid contentId → 400", async () => {
    const noId = await request(app)
      .post("/api/chat/tutor")
      .send({ mode: "free_chat", message: "hi" });
    expect(noId.status).toBe(400);
    expect(noId.body.message).toBe(
      "contentId is required and must be a valid id",
    );

    const badId = await request(app)
      .post("/api/chat/tutor")
      .send({ contentId: "not-an-id", mode: "free_chat", message: "hi" });
    expect(badId.status).toBe(400);
    expect(badId.body.message).toBe(
      "contentId is required and must be a valid id",
    );
  });

  it("2. bad mode → 400", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "banana",
        message: "hi",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "mode must be one of: free_chat, question_feedback, write_evaluation, followup",
    );
  });

  it("3. empty message → 400", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({ contentId: lesson._id.toString(), mode: "free_chat", message: "  " });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("message is required");
  });

  it("4. feedback mode without questionContext → 400", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "question_feedback",
        message: "คำตอบ",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "questionContext is required for feedback modes",
    );
  });

  it("5. valid free_chat anonymous public lesson → 200, no session", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "สวัสดี",
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reply: "MOCK_AI_REPLY",
      suggestions: [],
      sessionId: null,
    });
    expect(await ChatSession.countDocuments()).toBe(0);
  });

  it("6. anonymous clientThread → 3 contents entries with role mapping", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "คำถามใหม่",
        clientThread: [
          { role: "student", text: "ชื่อฉันบอล" },
          { role: "tutor", text: "สวัสดีบอล" },
        ],
      });
    const contents = capturedContents()!;
    expect(contents).toHaveLength(3);
    expect(contents[0]).toMatchObject({
      role: "user",
      parts: [{ text: "ชื่อฉันบอล" }],
    });
    expect(contents[1]).toMatchObject({
      role: "model",
      parts: [{ text: "สวัสดีบอล" }],
    });
    expect(contents[2]).toMatchObject({
      role: "user",
      parts: [{ text: "คำถามใหม่" }],
    });
  });

  it("7. anonymous private lesson → 401", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "private" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "hi",
      });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Login required to view this content");
  });

  it("8. stranger token private lesson → 403", async () => {
    const { user } = await seedUser();
    const { token: strangerToken } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "private" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .set("Authorization", `Bearer ${strangerToken}`)
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "hi",
      });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("No permission to view this content");
  });

  it("9. owner token private lesson → 200", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "private" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .set("Authorization", `Bearer ${token}`)
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "hi",
      });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("MOCK_AI_REPLY");
  });

  it("10. logged-in first message → session with 2 messages", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .set("Authorization", `Bearer ${token}`)
      .send({
        contentId: lesson._id.toString(),
        blockId: "q-choice-1",
        mode: "free_chat",
        message: "ข้อแรก",
      });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
    const session = await ChatSession.findById(res.body.sessionId);
    expect(session?.messages).toHaveLength(2);
    expect(session?.messages[0]).toMatchObject({
      role: "student",
      text: "ข้อแรก",
    });
    expect(session?.messages[1]).toMatchObject({
      role: "tutor",
      text: "MOCK_AI_REPLY",
    });
  });

  it("11. logged-in second message → same session, 4 messages, history in contents", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const base = {
      contentId: lesson._id.toString(),
      blockId: "block-a",
      mode: "free_chat" as const,
    };
    await request(app)
      .post("/api/chat/tutor")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...base, message: "เทิร์นแรก" });
    mockGenerateContent.mockClear();
    await request(app)
      .post("/api/chat/tutor")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...base, message: "เทิร์นสอง" });
    const contents = capturedContents()!;
    const texts = contents.map((c) => c.parts[0].text);
    expect(texts).toContain("เทิร์นแรก");
    expect(texts).toContain("MOCK_AI_REPLY");
    expect(texts).toContain("เทิร์นสอง");
    const sessions = await ChatSession.find({});
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages).toHaveLength(4);
  });

  it("12. logged-in fake clientThread ignored", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .set("Authorization", `Bearer ${token}`)
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "จริง",
        clientThread: [{ role: "student", text: "ปลอมมาก" }],
      });
    const texts = capturedContents()!.map((c) => c.parts[0].text);
    expect(texts).not.toContain("ปลอมมาก");
    expect(texts).toContain("จริง");
  });

  it("13. 52 messages pushed → session holds exactly 50", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const contentId = lesson._id.toString();
    for (let i = 1; i <= 26; i++) {
      await request(app)
        .post("/api/chat/tutor")
        .set("Authorization", `Bearer ${token}`)
        .send({
          contentId,
          blockId: "cap-test",
          mode: "free_chat",
          message: `msg-${i}`,
        });
    }
    const session = await ChatSession.findOne({
      user_id: user._id,
      content_id: lesson._id,
      block_id: "cap-test",
    });
    expect(session?.messages).toHaveLength(MAX_SESSION_MESSAGES);
    expect(session?.messages[0].text).toBe("msg-2");
    expect(session?.messages.at(-1)?.text).toBe("MOCK_AI_REPLY");
  });

  it('14. question_feedback level correct accuracy 100 → final turn contains level=correct', async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "question_feedback",
        message: "น้ำและ CO2",
        questionContext: {
          question: "วัตถุดิบคืออะไร",
          guideAnswer: "น้ำ | CO2",
          evaluation: { level: "correct", accuracyPercent: 100 },
          feedbackMode: "quick_check",
        },
      });
    const finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn).toContain("level=correct");
    expect(finalTurn).toContain("accuracy=100%");
  });

  it("15. write_evaluation ai_judge → ai_judge instruction, no level= line", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "write_evaluation",
        message: "พืชสำคัญเพราะผลิตออกซิเจน",
        questionContext: {
          question: "ทำไมพืชสำคัญ",
          guideAnswer: "ผลิตออกซิเจน",
          evaluation: { level: "ai_judge" },
        },
      });
    const finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn).toContain("ให้เธอประเมินเองอย่างใจดี");
    expect(finalTurn).not.toMatch(/level=/);
  });

  it("16. systemInstruction contains title, fixture phrase, guide answer, persona", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "อธิบายหน่อย",
      });
    const sys = capturedSystemInstruction();
    expect(sys).toContain("การสังเคราะห์แสง (Photosynthesis)");
    expect(sys).toContain("ปอดของโลก");
    expect(sys).toContain("น้ำ | คาร์บอนไดออกไซด์");
    expect(sys).toContain("น้องมันฝรั่ง");
    expect(sys).toContain("== YOUR CHARACTER ==");
    expect(sys).toContain("[SUGGESTIONS]");
  });

  it("17. mock rejects non-transient → 502", async () => {
    mockGenerateContent.mockRejectedValue(new Error("invalid argument"));
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "hi",
      });
    expect(res.status).toBe(502);
    expect(res.body.message).toBe("AI request failed");
  });

  it("18. nonexistent contentId → 404", async () => {
    const missing = new Types.ObjectId().toString();
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({ contentId: missing, mode: "free_chat", message: "hi" });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Content not found");
  });

  it("19. free_chat uses TUTOR_MODEL", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "สวัสดี",
      });
    expect(capturedModel()).toBe(getTutorModel());
  });

  it("20. question_feedback quick_check uses FAST_MODEL", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "question_feedback",
        message: "น้ำและ CO2",
        questionContext: {
          question: "วัตถุดิบคืออะไร",
          guideAnswer: "น้ำ | CO2",
          evaluation: { level: "correct", accuracyPercent: 100 },
          feedbackMode: "quick_check",
        },
      });
    expect(capturedModel()).toBe(
      (process.env.AI_FAST_MODEL || "gemini-2.5-flash-lite").trim(),
    );
  });

  it("21. question_feedback full_reflection uses TUTOR_MODEL", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "question_feedback",
        message: "พืชสำคัญเพราะผลิตออกซิเจน",
        questionContext: {
          question: "ทำไมพืชสำคัญ",
          guideAnswer: "ผลิตออกซิเจน",
          evaluation: { level: "almost", accuracyPercent: 70 },
          feedbackMode: "full_reflection",
        },
      });
    expect(capturedModel()).toBe(getTutorModel());
  });

  it("23. currentSection appended to final user turn (all modes), absent when omitted", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "อันนี้คืออะไร",
        currentSection: "หัวข้อ: การหายใจระดับเซลล์",
      });
    let finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn).toContain(
      "[ตอนนี้เพื่อนกำลังอ่าน/อยู่แถวส่วนนี้ของบทเรียน: หัวข้อ: การหายใจระดับเซลล์]",
    );

    mockGenerateContent.mockClear();
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "question_feedback",
        message: "น้ำ",
        currentSection: "หัวข้อ: วัตถุดิบ",
        questionContext: {
          question: "วัตถุดิบคืออะไร",
          evaluation: { level: "almost", accuracyPercent: 50 },
        },
      });
    finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn).toContain("[งานของเธอตอนนี้");
    expect(finalTurn).toContain(
      "[ตอนนี้เพื่อนกำลังอ่าน/อยู่แถวส่วนนี้ของบทเรียน: หัวข้อ: วัตถุดิบ]",
    );

    mockGenerateContent.mockClear();
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "ไม่มี section",
      });
    finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn).toBe("ไม่มี section");
  });

  it("24. diagnostics included in feedback turn, capped at 500 chars, absent when omitted", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "question_feedback",
        message: "น้ำ",
        questionContext: {
          question: "วัตถุดิบคืออะไร",
          evaluation: {
            level: "almost",
            accuracyPercent: 50,
            diagnostics: "missedCorrect=CO2; wrongSelected=(none)",
          },
        },
      });
    let finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn).toContain(
      "รายละเอียดการตรวจ (ระบบตรวจให้แล้ว): missedCorrect=CO2; wrongSelected=(none)",
    );

    mockGenerateContent.mockClear();
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "question_feedback",
        message: "น้ำ",
        questionContext: {
          question: "วัตถุดิบคืออะไร",
          evaluation: { level: "almost", accuracyPercent: 50 },
        },
      });
    finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn).not.toContain("รายละเอียดการตรวจ");

    mockGenerateContent.mockClear();
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "question_feedback",
        message: "น้ำ",
        questionContext: {
          question: "วัตถุดิบคืออะไร",
          evaluation: {
            level: "almost",
            accuracyPercent: 50,
            diagnostics: "x".repeat(600),
          },
        },
      });
    finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn).toContain("x".repeat(500));
    expect(finalTurn).not.toContain("x".repeat(501));
  });

  it("25. diagnostics ignored outside feedback modes", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "followup",
        message: "ขอ hint หน่อย",
        questionContext: {
          question: "วัตถุดิบคืออะไร",
          evaluation: { level: "almost", diagnostics: "should-not-appear" },
        },
      });
    const finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn).toBe("ขอ hint หน่อย");
    expect(finalTurn).not.toContain("should-not-appear");
  });

  it("26. followup with a question blockId → question anchor tag appended", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        blockId: "q-choice-1",
        mode: "followup",
        message: "แล้วทรายล่ะ ทำไมไม่ใช่?",
      });
    const finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn.startsWith("แล้วทรายล่ะ ทำไมไม่ใช่?")).toBe(true);
    expect(finalTurn).toContain(
      "[คำถามที่คุยกันอยู่: ข้อใดคือวัตถุดิบของการสังเคราะห์แสง?]",
    );
  });

  it("27. followup with unknown/absent blockId → raw message untouched", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        blockId: "__lesson_ai_assistant__",
        mode: "followup",
        message: "ขอ hint หน่อย",
      });
    const finalTurn = capturedContents()!.at(-1)!.parts[0].text;
    expect(finalTurn).toBe("ขอ hint หน่อย");
  });

  it("28. leading tutor turns dropped so contents start with a user turn", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "followup",
        message: "โอเค เข้าใจละ",
        clientThread: [
          { role: "tutor", text: "ฟีดแบ็กแรกจากติวเตอร์" },
          { role: "student", text: "ขอบคุณ" },
          { role: "tutor", text: "ยินดีจ้า" },
        ],
      });
    const contents = capturedContents()!;
    expect(contents[0].role).toBe("user");
    expect(contents.map((c) => c.parts[0].text)).not.toContain(
      "ฟีดแบ็กแรกจากติวเตอร์",
    );
    expect(contents.map((c) => c.parts[0].text)).toContain("ขอบคุณ");
  });

  it("29. leaked internal tag in the model reply is stripped end-to-end", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: [
        "[งานของเธอตอนนี้: ให้ฟีดแบ็กคำตอบของเพื่อน]",
        "เยี่ยมเลย! ไอเดียเรื่องต้นไม้นี่คิดได้ดีมาก",
      ].join("\n"),
    });
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "question_feedback",
        message: "ต้นไม้",
        questionContext: {
          question: "วัตถุดิบคืออะไร",
          evaluation: { level: "almost", accuracyPercent: 50 },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(
      "เยี่ยมเลย! ไอเดียเรื่องต้นไม้นี่คิดได้ดีมาก",
    );
    expect(res.body.reply).not.toContain("[งานของเธอตอนนี้");
  });

  it("22. parses [SUGGESTIONS] block from AI reply", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: [
        "เยี่ยมเลย! ตรงที่เธอเชื่อมแสงกับอาหารนี่คิดได้ดีมาก",
        "",
        "[SUGGESTIONS]",
        "- แล้วน้ำมีบทบาทยังไง?",
        "- ทำไมต้องมีคลอโรฟิลล์?",
        "- ถ้าไม่มีแสงจะเกิดอะไรขึ้น?",
      ].join("\n"),
    });
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "อธิบายการสังเคราะห์แสง",
      });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(
      "เยี่ยมเลย! ตรงที่เธอเชื่อมแสงกับอาหารนี่คิดได้ดีมาก",
    );
    expect(res.body.suggestions).toEqual([
      "แล้วน้ำมีบทบาทยังไง?",
      "ทำไมต้องมีคลอโรฟิลล์?",
      "ถ้าไม่มีแสงจะเกิดอะไรขึ้น?",
    ]);
  });

  it("23. lesson agent_settings persona_note appears in system instruction", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, {
      access_type: "public",
      agent_settings: {
        persona_note: "พูดเหมือนโค้ชกีฬา",
        allow_direct_answers: false,
        scope: "lesson_plus_general",
        custom_guidelines: "",
      },
    });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "สวัสดี",
      });
    expect(capturedSystemInstruction()).toContain(
      "== การตั้งค่าจากคุณครูของบทเรียนนี้ ==",
    );
    expect(capturedSystemInstruction()).toContain("พูดเหมือนโค้ชกีฬา");
  });

  it("24. personality sassy in request → system instruction contains sassy block", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "hi",
        personality: "sassy",
      });
    expect(capturedSystemInstruction()).toContain("แซวเพื่อนได้แบบน่ารักๆ");
  });

  it("25. invalid personality → 200 with default instruction", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "hi",
        personality: "not-a-real-id",
      });
    expect(res.status).toBe(200);
    expect(capturedSystemInstruction()).not.toContain(
      "== สไตล์การคุยที่เพื่อนเลือก ==",
    );
  });

  it("26. logged-in personality syncs to StudentMemory", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .set("Authorization", `Bearer ${token}`)
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "hi",
        personality: "gentle",
      });
    // The controller fire-and-forgets this write (never blocks the tutor
    // reply), so poll instead of reading once — a single read races the write.
    await vi.waitFor(async () => {
      const memory = await StudentMemory.findOne({ user_id: user._id });
      expect(memory?.tutor_personality).toBe("gentle");
    });
  });

  it("27. AI_DEBUG_PROMPTS logs when enabled", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prev = process.env.AI_DEBUG_PROMPTS;
    process.env.AI_DEBUG_PROMPTS = "true";

    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "hi",
      });

    const debugLines = logSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes("[AI_DEBUG]"));
    expect(debugLines.length).toBeGreaterThan(0);

    logSpy.mockRestore();
    if (prev === undefined) delete process.env.AI_DEBUG_PROMPTS;
    else process.env.AI_DEBUG_PROMPTS = prev;
  });

  it("28. AI_DEBUG_PROMPTS does not log when unset", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prev = process.env.AI_DEBUG_PROMPTS;
    delete process.env.AI_DEBUG_PROMPTS;

    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "hi",
      });

    const debugLines = logSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes("[AI_DEBUG]"));
    expect(debugLines.length).toBe(0);

    logSpy.mockRestore();
    if (prev !== undefined) process.env.AI_DEBUG_PROMPTS = prev;
  });
});
