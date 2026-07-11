import { describe, it, expect } from "vitest";
import {
  sanitizeGeneratedQuestions,
  validateAgentSettingsResult,
  validateCriticResult,
  validateDistractorsResult,
  validateFormulaLatexResult,
  validateGenerateQuestionsResult,
  validateImportStructureResult,
  validateLessonMetaResult,
} from "../../src/services/creator/validate";

const validChoice = {
  type: "choice",
  question: "พืชใช้อะไรสังเคราะห์แสง?",
  choices: [
    { text: "แสงอาทิตย์", correct: true },
    { text: "เสียง", correct: false },
    { text: "ลม", correct: false },
  ],
};

const validWrite = {
  type: "write",
  question: "อธิบายการสังเคราะห์แสง",
  guideAnswer: "พืชใช้แสง น้ำ CO2 สร้างกลูโคสและออกซิเจน",
};

describe("sanitizeGeneratedQuestions", () => {
  it("keeps valid items of every type", () => {
    const items = [
      validChoice,
      validWrite,
      {
        type: "blank_choice",
        template: "พืชใช้ [Q-1] และ [Q-2] ในการสังเคราะห์แสง",
        choices: ["น้ำ", "แสง", "เสียง"],
        correctByBlank: [0, 1],
      },
      {
        type: "blank_write",
        template: "ผลผลิตคือ [Q-1]",
        blankAnswers: ["กลูโคส"],
      },
    ];
    expect(sanitizeGeneratedQuestions(items)).toHaveLength(4);
  });

  it("drops a choice question with 0 correct answers, keeps valid siblings", () => {
    const broken = {
      ...validChoice,
      choices: validChoice.choices.map((c) => ({ ...c, correct: false })),
    };
    const out = sanitizeGeneratedQuestions([broken, validWrite]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("write");
  });

  it("drops a choice question with 2 correct answers", () => {
    const broken = {
      ...validChoice,
      choices: [
        { text: "ก", correct: true },
        { text: "ข", correct: true },
        { text: "ค", correct: false },
      ],
    };
    expect(sanitizeGeneratedQuestions([broken])).toHaveLength(0);
  });

  it("drops choice with fewer than 3 or more than 5 choices", () => {
    const two = { ...validChoice, choices: validChoice.choices.slice(0, 2) };
    const six = {
      ...validChoice,
      choices: [
        { text: "1", correct: true },
        ...[2, 3, 4, 5, 6].map((n) => ({ text: String(n), correct: false })),
      ],
    };
    expect(sanitizeGeneratedQuestions([two, six])).toHaveLength(0);
  });

  it("drops blank_choice with non-contiguous [Q-n] tokens", () => {
    const broken = {
      type: "blank_choice",
      template: "ช่องแรก [Q-1] ช่องต่อไป [Q-3]",
      choices: ["ก", "ข"],
      correctByBlank: [0, 1],
    };
    expect(sanitizeGeneratedQuestions([broken])).toHaveLength(0);
  });

  it("drops blank_choice with wrong correctByBlank length or bad index", () => {
    const wrongLen = {
      type: "blank_choice",
      template: "หนึ่งช่อง [Q-1]",
      choices: ["ก", "ข"],
      correctByBlank: [0, 1],
    };
    const badIndex = {
      type: "blank_choice",
      template: "หนึ่งช่อง [Q-1]",
      choices: ["ก", "ข"],
      correctByBlank: [5],
    };
    expect(sanitizeGeneratedQuestions([wrongLen, badIndex])).toHaveLength(0);
  });

  it("drops blank_write when blankAnswers length mismatches blanks", () => {
    const broken = {
      type: "blank_write",
      template: "[Q-1] และ [Q-2]",
      blankAnswers: ["เดียว"],
    };
    expect(sanitizeGeneratedQuestions([broken])).toHaveLength(0);
  });

  it("normalizes {{n}} templates to [Q-n]", () => {
    const item = {
      type: "blank_write",
      template: "ผลผลิตคือ {{1}} และ {{2}}",
      blankAnswers: ["กลูโคส", "ออกซิเจน"],
    };
    const out = sanitizeGeneratedQuestions([item]);
    expect(out).toHaveLength(1);
    expect((out[0] as { template: string }).template).toBe(
      "ผลผลิตคือ [Q-1] และ [Q-2]",
    );
  });

  it("drops templates with no blank tokens and non-object items", () => {
    const noBlank = {
      type: "blank_write",
      template: "ไม่มีช่องว่างเลย",
      blankAnswers: [],
    };
    expect(sanitizeGeneratedQuestions([noBlank, "junk", null, 42])).toHaveLength(0);
  });
});

describe("validateGenerateQuestionsResult", () => {
  it("null when everything was dropped (treated as parse failure)", () => {
    expect(validateGenerateQuestionsResult({ questions: ["junk"] })).toBeNull();
    expect(validateGenerateQuestionsResult({ questions: [] })).toBeNull();
    expect(validateGenerateQuestionsResult("not an object")).toBeNull();
  });

  it("passes through valid questions", () => {
    const out = validateGenerateQuestionsResult({ questions: [validChoice] });
    expect(out?.questions).toHaveLength(1);
  });
});

describe("validateFormulaLatexResult", () => {
  it("accepts latex, keeps note only when present", () => {
    expect(validateFormulaLatexResult({ latex: "s = ut + \\frac{1}{2}at^2" }))
      .toEqual({ latex: "s = ut + \\frac{1}{2}at^2" });
    expect(
      validateFormulaLatexResult({ latex: "E=mc^2", note: "เดาว่า c คือความเร็วแสง" }),
    ).toEqual({ latex: "E=mc^2", note: "เดาว่า c คือความเร็วแสง" });
  });

  it("rejects missing/empty latex", () => {
    expect(validateFormulaLatexResult({ note: "x" })).toBeNull();
    expect(validateFormulaLatexResult({ latex: "  " })).toBeNull();
  });
});

describe("validateDistractorsResult", () => {
  it("accepts exactly 3, filters duplicates of correct/existing", () => {
    const out = validateDistractorsResult({
      raw: { distractors: ["แสงจันทร์", "ไฟฟ้า", "ความร้อนใต้พิภพ"] },
      correctText: "แสงอาทิตย์",
      existing: [],
    });
    expect(out?.distractors).toHaveLength(3);
  });

  it("null when a filtered duplicate leaves fewer than 3", () => {
    const out = validateDistractorsResult({
      raw: { distractors: ["แสงอาทิตย์", "ไฟฟ้า", "ลม"] },
      correctText: "แสงอาทิตย์",
      existing: [],
    });
    expect(out).toBeNull();
  });

  it("takes the first 3 when the model over-delivers", () => {
    const out = validateDistractorsResult({
      raw: { distractors: ["ก", "ข", "ค", "ง"] },
      correctText: "จ",
      existing: [],
    });
    expect(out?.distractors).toEqual(["ก", "ข", "ค"]);
  });
});

describe("validateCriticResult", () => {
  const valid = {
    summary: "บทเรียนอ่านลื่นมาก มีตัวอย่างดี",
    issues: [
      {
        area: "readability",
        severity: "info",
        where: "หัวข้อที่ 2",
        note: "ประโยคยาวไปนิด",
        suggestion: "แบ่งเป็นสองประโยค",
      },
    ],
    checklist: [{ item: "มีคำนำ/เกริ่น", pass: true }],
  };

  it("accepts a valid report", () => {
    const out = validateCriticResult(valid);
    expect(out?.summary).toContain("อ่านลื่น");
    expect(out?.issues).toHaveLength(1);
    expect(out?.checklist).toHaveLength(1);
  });

  it("drops issues with bad area, caps at 12, requires checklist", () => {
    const out = validateCriticResult({
      ...valid,
      issues: [
        { ...valid.issues[0], area: "vibes" },
        ...Array.from({ length: 20 }, (_, i) => ({
          area: "questions",
          severity: "warn",
          where: `q${i}`,
          note: `issue ${i}`,
        })),
      ],
    });
    expect(out?.issues).toHaveLength(12);
    expect(validateCriticResult({ ...valid, checklist: [] })).toBeNull();
    expect(validateCriticResult({ ...valid, summary: "" })).toBeNull();
  });
});

describe("validateLessonMetaResult", () => {
  it("clamps topics to 5 and requires a title", () => {
    const out = validateLessonMetaResult({
      title: "การสังเคราะห์แสง",
      description: "เรียนรู้ว่าพืชสร้างอาหารยังไง",
      topics: ["ชีววิทยา", "พืช", "พลังงาน", "ระบบนิเวศ", "วิทย์", "เกิน"],
    });
    expect(out?.topics).toHaveLength(5);
    expect(validateLessonMetaResult({ description: "x" })).toBeNull();
  });
});

describe("validateAgentSettingsResult", () => {
  it("accepts valid settings and clamps to model limits", () => {
    const out = validateAgentSettingsResult({
      persona_note: "อบอุ่น ชวนคิดแบบนักชีววิทยา",
      custom_guidelines: "อย่าเฉลยข้อ 3 ตรงๆ",
      scope: "lesson_only",
      allow_direct_answers: false,
      reason: "เนื้อหาเน้นความเข้าใจ",
    });
    expect(out?.scope).toBe("lesson_only");
    expect(out?.allow_direct_answers).toBe(false);
  });

  it("rejects bad scope or non-boolean allow_direct_answers", () => {
    expect(
      validateAgentSettingsResult({
        scope: "everything",
        allow_direct_answers: false,
      }),
    ).toBeNull();
    expect(
      validateAgentSettingsResult({
        scope: "lesson_only",
        allow_direct_answers: "yes",
      }),
    ).toBeNull();
  });
});

describe("validateImportStructureResult", () => {
  it("requires markdown, tolerates missing questions, caps at 5", () => {
    expect(validateImportStructureResult({ markdown: "" })).toBeNull();
    const out = validateImportStructureResult({
      markdown: "## หัวข้อ\nเนื้อหา",
      suggestedQuestions: Array.from({ length: 7 }, () => validWrite),
    });
    expect(out?.suggestedQuestions).toHaveLength(5);
    const noQuestions = validateImportStructureResult({ markdown: "## ok" });
    expect(noQuestions?.suggestedQuestions).toEqual([]);
  });
});
