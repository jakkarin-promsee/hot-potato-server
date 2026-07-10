import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { Types } from "mongoose";

const { mockGenerateContentStream } = vi.hoisted(() => ({
  mockGenerateContentStream: vi.fn(async () =>
    (async function* () {
      yield { text: "สวัสดี " };
      yield { text: "จ้า\n[SUGGES" };
      yield { text: "TIONS]\n- ถามต่อยอด" };
    })(),
  ),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: vi.fn(async () => ({ text: "MOCK_AI_REPLY" })),
      generateContentStream: mockGenerateContentStream,
    };
  },
}));

import app from "../../src/app";
import { ChatSession } from "../../src/models/chat_session.model";
import { clearLessonContextCache } from "../../src/services/lessonContext.service";
import { seedLesson, seedUser } from "../helpers/seed";

function parseSseEvents(body: string): { event: string; data: unknown }[] {
  const events: { event: string; data: unknown }[] = [];
  for (const block of body.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "";
    let dataLine = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      if (line.startsWith("data: ")) dataLine = line.slice(6);
    }
    if (event && dataLine) {
      events.push({ event, data: JSON.parse(dataLine) });
    }
  }
  return events;
}

beforeEach(() => {
  mockGenerateContentStream.mockClear();
  mockGenerateContentStream.mockImplementation(async () =>
    (async function* () {
      yield { text: "สวัสดี " };
      yield { text: "จ้า\n[SUGGES" };
      yield { text: "TIONS]\n- ถามต่อยอด" };
    })(),
  );
  clearLessonContextCache();
});

describe("POST /api/chat/tutor stream", () => {
  it("1. stream: true free_chat anonymous → tokens, suggestions, done", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "สวัสดี",
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    const events = parseSseEvents(res.text);
    const tokens = events.filter((e) => e.event === "token");
    const tokenText = tokens.map((e) => (e.data as { text: string }).text).join("");
    expect(tokenText.trimEnd()).toBe("สวัสดี จ้า");
    expect(res.text).not.toContain("[SUGGESTIONS]");

    const suggestions = events.find((e) => e.event === "suggestions");
    expect(suggestions?.data).toEqual({ suggestions: ["ถามต่อยอด"] });

    const done = events.find((e) => e.event === "done");
    expect(done?.data).toMatchObject({
      reply: "สวัสดี จ้า",
      sessionId: null,
    });
  });

  it("2. stream: true logged-in → session saved with canonical reply", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .set("Authorization", `Bearer ${token}`)
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "สวัสดี",
        stream: true,
      });

    expect(res.status).toBe(200);
    const done = parseSseEvents(res.text).find((e) => e.event === "done");
    const sessionId = (done?.data as { sessionId: string }).sessionId;
    expect(sessionId).toBeTruthy();

    const session = await ChatSession.findById(sessionId);
    expect(session?.messages.at(-1)?.text).toBe("สวัสดี จ้า");
    expect(session?.messages.at(-1)?.text).not.toContain("[SUGGESTIONS]");
  });

  it("3. stream: true invalid mode → JSON 400, no SSE", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "banana",
        message: "hi",
        stream: true,
      });
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/json/);
  });

  it("4. mid-stream throw → error event, no session saved", async () => {
    mockGenerateContentStream.mockImplementationOnce(async () =>
      (async function* () {
        yield { text: "partial " };
        throw new Error("stream broke");
      })(),
    );

    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .set("Authorization", `Bearer ${token}`)
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "test",
        stream: true,
      });

    const events = parseSseEvents(res.text);
    expect(events.some((e) => e.event === "error")).toBe(true);
    expect(events.some((e) => e.event === "done")).toBe(false);

    const count = await ChatSession.countDocuments({
      user_id: new Types.ObjectId(user._id),
      content_id: lesson._id,
    });
    expect(count).toBe(0);
  });

  it("5. stream absent → JSON response unchanged", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app)
      .post("/api/chat/tutor")
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "hi",
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.reply).toBe("MOCK_AI_REPLY");
  });
});
