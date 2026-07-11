import { describe, it, expect } from "vitest";
import {
  buildOutlinePrompt,
  buildDraftSectionPrompt,
  buildGenerateQuestionsPrompt,
  buildGuideAnswerPrompt,
  buildProofreadPrompt,
} from "../../src/services/creator/prompts";
import type { LessonContext } from "../../src/services/lessonContext.service";

const lesson: LessonContext = {
  contentId: "c1",
  updatedAt: new Date(),
  title: "เซลล์",
  accessType: "public",
  ownerId: "o1",
  collaboratorIds: [],
  text: "เนื้อหาบทเรียน",
  questions: [],
  agentSettings: {
    persona_note: "",
    allow_direct_answers: false,
    scope: "lesson_plus_general",
    custom_guidelines: "",
  },
};

const GLOSS_FORMAT = '"คำไทย (คำอังกฤษ)"';

function withLang<T>(lang: string, fn: () => T): T {
  const prev = process.env.AI_OUTPUT_LANGUAGE;
  process.env.AI_OUTPUT_LANGUAGE = lang;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.AI_OUTPUT_LANGUAGE;
    else process.env.AI_OUTPUT_LANGUAGE = prev;
  }
}

describe("creator prompts — loanword gloss rule", () => {
  it("content-generating actions carry the loanword rule (Thai)", () => {
    withLang("thai", () => {
      const prompts = [
        buildOutlinePrompt({ topic: "เซลล์" }),
        buildDraftSectionPrompt({ lesson, heading: "ส่วนที่ 1" }),
        buildGenerateQuestionsPrompt({
          lesson,
          scope: "lesson",
          types: ["choice"],
          count: 2,
          difficulty: "easy",
        }),
        buildGuideAnswerPrompt({ lesson, question: "เซลล์คืออะไร" }),
      ];
      for (const p of prompts) {
        expect(p.systemInstruction).toContain("คำทับศัพท์");
        expect(p.systemInstruction).toContain(GLOSS_FORMAT);
        expect(p.systemInstruction).toContain("อิเล็กตรอน (electron)");
      }
    });
  });

  it("rewriting proofread presets carry the rule; verbatim ones (proofread/format) do not", () => {
    withLang("thai", () => {
      for (const preset of ["simplify", "expand", "shorten", "reading_level"] as const) {
        const p = buildProofreadPrompt({ markdown: "x", preset });
        expect(p.systemInstruction, preset).toContain("คำทับศัพท์");
      }
      for (const preset of ["proofread", "format"] as const) {
        const p = buildProofreadPrompt({ markdown: "x", preset });
        expect(p.systemInstruction, preset).not.toContain("คำทับศัพท์");
      }
    });
  });

  it("english output omits the loanword rule", () => {
    withLang("english", () => {
      expect(buildOutlinePrompt({ topic: "cell" }).systemInstruction).not.toContain(
        "คำทับศัพท์",
      );
    });
  });
});
