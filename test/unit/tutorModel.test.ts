import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveTutorModel } from "../../src/controllers/tutor.controller";

describe("resolveTutorModel", () => {
  const saved = {
    fast: process.env.AI_FAST_MODEL,
    tutor: process.env.AI_TUTOR_MODEL,
    heavy: process.env.AI_HEAVY_MODEL,
  };

  afterEach(() => {
    if (saved.fast === undefined) delete process.env.AI_FAST_MODEL;
    else process.env.AI_FAST_MODEL = saved.fast;
    if (saved.tutor === undefined) delete process.env.AI_TUTOR_MODEL;
    else process.env.AI_TUTOR_MODEL = saved.tutor;
    if (saved.heavy === undefined) delete process.env.AI_HEAVY_MODEL;
    else process.env.AI_HEAVY_MODEL = saved.heavy;
  });

  it("1. free_chat → TUTOR_MODEL default", () => {
    delete process.env.AI_TUTOR_MODEL;
    delete process.env.AI_HEAVY_MODEL;
    expect(resolveTutorModel("free_chat")).toBe("gemini-2.5-flash");
  });

  it("2. followup → TUTOR_MODEL", () => {
    process.env.AI_TUTOR_MODEL = "custom-tutor";
    expect(resolveTutorModel("followup")).toBe("custom-tutor");
  });

  it("3. write_evaluation → TUTOR_MODEL", () => {
    process.env.AI_TUTOR_MODEL = "custom-tutor";
    expect(resolveTutorModel("write_evaluation")).toBe("custom-tutor");
  });

  it("4. question_feedback quick_check → FAST_MODEL", () => {
    process.env.AI_FAST_MODEL = "custom-fast";
    expect(resolveTutorModel("question_feedback", "quick_check")).toBe(
      "custom-fast",
    );
  });

  it("5. question_feedback full_reflection → TUTOR_MODEL", () => {
    process.env.AI_TUTOR_MODEL = "custom-tutor";
    expect(resolveTutorModel("question_feedback", "full_reflection")).toBe(
      "custom-tutor",
    );
  });

  it("6. AI_HEAVY_MODEL legacy alias when AI_TUTOR_MODEL unset", () => {
    delete process.env.AI_TUTOR_MODEL;
    process.env.AI_HEAVY_MODEL = "legacy-heavy";
    expect(resolveTutorModel("free_chat")).toBe("legacy-heavy");
  });
});
