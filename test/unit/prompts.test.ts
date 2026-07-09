import { describe, it, expect } from "vitest";
import {
  buildLearningPrompt,
  buildFeedbackPrompt,
  buildWriteEvaluationPrompt,
} from "../../src/controllers/chat.controller";

describe("buildLearningPrompt", () => {
  it("1. includes all three labelled sections and their content", () => {
    const p = buildLearningPrompt("Q", "CTX", "UCTX");
    expect(p).toContain("=== Learning Content ===");
    expect(p).toContain("CTX");
    expect(p).toContain("=== Learner Chat History ===");
    expect(p).toContain("UCTX");
    expect(p).toContain("=== Learner Question ===");
    expect(p).toContain("Q");
  });

  it("2. uses placeholders when context/userContext are empty", () => {
    const p = buildLearningPrompt("Q", "", "");
    expect(p).toContain("(No learning content provided)");
    expect(p).toContain("(No prior learner chat context provided)");
  });

  it("8. defaults to Thai output instruction", () => {
    const p = buildLearningPrompt("Q", "CTX", "UCTX");
    expect(p).toContain("ภาษาไทย");
  });
});

describe("buildFeedbackPrompt", () => {
  it("3. contains the persona tripwire rules", () => {
    const p = buildFeedbackPrompt(
      "q",
      "c",
      "u",
      "almost",
      70,
      "diag",
      "quick_check",
    );
    // If either of these lines is ever silently dropped, this test fails —
    // that is the whole point of the tripwire.
    expect(p).toContain("Never label the learner as 'wrong'");
    expect(p).toContain("You MUST follow the provided evaluation level");
  });

  it("4. echoes the provided evaluation level and accuracy percent", () => {
    const p = buildFeedbackPrompt(
      "q",
      "c",
      "u",
      "almost",
      70,
      "diag",
      "quick_check",
    );
    expect(p).toContain("level: almost");
    expect(p).toContain("accuracyPercent: 70");
  });

  it("5. length instruction differs by feedback mode", () => {
    const quick = buildFeedbackPrompt("q", "c", "u", "correct", 100, "", "quick_check");
    const full = buildFeedbackPrompt("q", "c", "u", "correct", 100, "", "full_reflection");
    expect(quick).toContain("1-3 sentences");
    expect(full).toContain("5-8 sentences");
  });

  it("8. defaults to Thai output instruction", () => {
    const p = buildFeedbackPrompt("q", "c", "u", "correct", 100, "", "quick_check");
    expect(p).toContain("ภาษาไทย");
  });
});

describe("buildWriteEvaluationPrompt", () => {
  it("6. contains the reference-direction and strengths-first rules", () => {
    const p = buildWriteEvaluationPrompt("q", "g", "s", "quick_check");
    expect(p).toContain(
      "The teacher guide answer is only a reference direction",
    );
    expect(p).toContain("Start with strengths");
  });

  it("8. defaults to Thai output instruction", () => {
    const p = buildWriteEvaluationPrompt("q", "g", "s", "quick_check");
    expect(p).toContain("ภาษาไทย");
  });
});

describe("7. full-prompt snapshots (any prompt edit shows up as a reviewed diff)", () => {
  it("buildLearningPrompt snapshot", () => {
    expect(buildLearningPrompt("Explain this", "LESSON", "HISTORY")).toMatchSnapshot();
  });

  it("buildFeedbackPrompt snapshot", () => {
    expect(
      buildFeedbackPrompt(
        "What is 2+2?",
        "4",
        "5",
        "almost",
        60,
        "missedCorrect=4",
        "full_reflection",
      ),
    ).toMatchSnapshot();
  });

  it("buildWriteEvaluationPrompt snapshot", () => {
    expect(
      buildWriteEvaluationPrompt(
        "Explain photosynthesis",
        "Plants make food from sunlight",
        "Plants eat sun",
        "quick_check",
      ),
    ).toMatchSnapshot();
  });
});
