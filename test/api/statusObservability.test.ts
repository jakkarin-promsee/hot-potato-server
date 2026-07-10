import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(async () => ({ text: "MOCK_AI_REPLY" })),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

import app from "../../src/app";
import { resetObservabilityForTests } from "../../src/services/observability.service";
import { clearLessonContextCache } from "../../src/services/lessonContext.service";
import { seedLesson, seedUser } from "../helpers/seed";

beforeEach(() => {
  mockGenerateContent.mockClear();
  mockGenerateContent.mockResolvedValue({ text: "MOCK_AI_REPLY" });
  clearLessonContextCache();
  resetObservabilityForTests();
});

describe("Tier 1.A — /api/status/all observability payload", () => {
  it("baseline: ai unknown + zero errors, anonymous access works", async () => {
    const res = await request(app).get("/api/status/all");
    expect(res.status).toBe(200);
    expect(res.body.checks.ai).toEqual({
      status: "unknown",
      last_success: null,
      last_failure: null,
    });
    expect(res.body.checks.errors.count_since_boot).toBe(0);
    expect(res.body.checks.errors.recent).toEqual([]);
    expect(typeof res.body.checks.errors.since).toBe("string");
  });

  it("successful tutor call flips ai.status to ok", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });

    const chat = await request(app).post("/api/chat/tutor").send({
      contentId: lesson._id.toString(),
      mode: "free_chat",
      message: "สวัสดี",
    });
    expect(chat.status).toBe(200);

    const res = await request(app).get("/api/status/all");
    expect(res.body.checks.ai.status).toBe("ok");
    expect(res.body.checks.ai.last_success).toBeTruthy();
    expect(res.body.checks.errors.count_since_boot).toBe(0);
  });

  it("failed tutor call → ai degraded + sanitized ring-buffer entry", async () => {
    mockGenerateContent.mockRejectedValue(new Error("boom"));

    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });

    const chat = await request(app).post("/api/chat/tutor").send({
      contentId: lesson._id.toString(),
      mode: "free_chat",
      message: "สวัสดี",
    });
    expect(chat.status).toBe(502);

    const res = await request(app).get("/api/status/all");
    expect(res.body.checks.ai.status).toBe("degraded");
    expect(res.body.checks.ai.last_failure).toBeTruthy();

    const entry = res.body.checks.errors.recent[0];
    expect(entry).toMatchObject({
      method: "POST",
      route: "/api/chat/tutor",
      status: 502,
    });
    expect(entry.name).toBeUndefined();
    expect(entry.message).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("boom");
  });

  it("payload is identical for logged-in users (no privileged leak)", async () => {
    const { token } = await seedUser();
    const res = await request(app)
      .get("/api/status/all")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.checks.ai).toBeDefined();
    expect(res.body.checks.errors).toBeDefined();
    expect(res.body.checks.errors.recent.every(
      (e: Record<string, unknown>) => e.name === undefined,
    )).toBe(true);
  });

  it("admin GET /api/status/ includes error names", async () => {
    mockGenerateContent.mockRejectedValue(new Error("boom"));
    const { user, token } = await seedUser({ role: "admin" });
    const lesson = await seedLesson(user._id, { access_type: "public" });
    await request(app).post("/api/chat/tutor").send({
      contentId: lesson._id.toString(),
      mode: "free_chat",
      message: "hi",
    });

    const res = await request(app)
      .get("/api/status/")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.errors.recent[0].name).toBe("Error");
    expect(res.body.ai.status).toBe("degraded");
  });
});
