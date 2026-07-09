import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Gemini mock (Step -1.4). vi.mock factories are hoisted, so the mock fn is
// created with vi.hoisted. Do not deviate from this shape.
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(async () => ({
    response: { text: () => "MOCK_AI_REPLY" },
  })),
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mockGenerateContent };
    }
  },
}));

import app from "../../src/app";

// The first argument passed to generateContent is the full prompt string.
function capturedPrompt(): string {
  return String(mockGenerateContent.mock.calls[0]?.[0] ?? "");
}

beforeEach(() => {
  mockGenerateContent.mockClear();
});

describe("POST /api/chat/ask", () => {
  it("1. missing prompt → 400", async () => {
    const res = await request(app).post("/api/chat/ask").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("prompt is required");
  });

  it("2. happy path → 200 and prompt contains all three sections", async () => {
    const res = await request(app)
      .post("/api/chat/ask")
      .send({ prompt: "อธิบายหน่อย", context: "LESSON", userContext: "HIST" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ answer: "MOCK_AI_REPLY" });
    const p = capturedPrompt();
    expect(p).toContain("อธิบายหน่อย");
    expect(p).toContain("LESSON");
    expect(p).toContain("HIST");
  });

  it("3. works with no auth header (Golden Rule 2)", async () => {
    const res = await request(app)
      .post("/api/chat/ask")
      .send({ prompt: "hi" });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/chat/feedback", () => {
  it("4. missing question → 400", async () => {
    const res = await request(app).post("/api/chat/feedback").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("question is required");
  });

  it("5. invalid evaluationLevel coerces to incorrect", async () => {
    const res = await request(app)
      .post("/api/chat/feedback")
      .send({ question: "q", evaluationLevel: "banana" });
    expect(res.status).toBe(200);
    expect(capturedPrompt()).toContain("level: incorrect");
  });

  it("6. accuracyPercent is clamped to 0..100", async () => {
    const hi = await request(app)
      .post("/api/chat/feedback")
      .send({ question: "q", accuracyPercent: 150 });
    expect(hi.status).toBe(200);
    expect(capturedPrompt()).toContain("accuracyPercent: 100");

    mockGenerateContent.mockClear();
    const lo = await request(app)
      .post("/api/chat/feedback")
      .send({ question: "q", accuracyPercent: -5 });
    expect(lo.status).toBe(200);
    expect(capturedPrompt()).toContain("accuracyPercent: 0");
  });

  it("7. feedbackMode is trimmed + lowercased", async () => {
    const res = await request(app)
      .post("/api/chat/feedback")
      .send({ question: "q", feedbackMode: "  FULL_REFLECTION  " });
    expect(res.status).toBe(200);
    expect(capturedPrompt()).toContain("Mode: full_reflection");
  });

  it("12. works with no auth header (Golden Rule 2)", async () => {
    const res = await request(app)
      .post("/api/chat/feedback")
      .send({ question: "q" });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/chat/write-evaluate", () => {
  it("8. missing studentAnswer → 400", async () => {
    const res = await request(app)
      .post("/api/chat/write-evaluate")
      .send({ question: "q" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("question and studentAnswer are required");
  });

  it("9. happy path → 200 { feedback }", async () => {
    const res = await request(app)
      .post("/api/chat/write-evaluate")
      .send({ question: "q", studentAnswer: "my answer" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ feedback: "MOCK_AI_REPLY" });
  });

  it("13. works with no auth header (Golden Rule 2)", async () => {
    const res = await request(app)
      .post("/api/chat/write-evaluate")
      .send({ question: "q", studentAnswer: "my answer" });
    expect(res.status).toBe(200);
  });
});

describe("error paths", () => {
  it("10. missing GEMINI_API_KEY → 500", async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const res = await request(app)
        .post("/api/chat/ask")
        .send({ prompt: "hi" });
      expect(res.status).toBe(500);
      expect(res.body.message).toBe("Missing GEMINI_API_KEY in server env");
    } finally {
      process.env.GEMINI_API_KEY = saved;
    }
  });

  it("11. non-transient AI failure → 500", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("boom"));
    const res = await request(app)
      .post("/api/chat/ask")
      .send({ prompt: "hi" });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Gemini request failed");
  });
});
