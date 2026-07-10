import { describe, it, expect, beforeEach } from "vitest";
import { Types } from "mongoose";
import {
  clearLessonContextCache,
  getLessonContext,
  serializeTiptapJsonForTest,
} from "../../src/services/lessonContext.service";
import { Content } from "../../src/models/content.model";
import { seedLesson, seedUser } from "../helpers/seed";

function doc(...nodes: object[]): string {
  return JSON.stringify({ type: "doc", content: nodes });
}

describe("serializeTiptapJsonForTest", () => {
  it("heading → H{level}: text", () => {
    const { text } = serializeTiptapJsonForTest(
      doc({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "หัวข้อ" }],
      }),
    );
    expect(text).toBe("H2: หัวข้อ");
  });

  it("paragraph → plain text", () => {
    const { text } = serializeTiptapJsonForTest(
      doc({
        type: "paragraph",
        content: [{ type: "text", text: "ย่อหน้า" }],
      }),
    );
    expect(text).toBe("ย่อหน้า");
  });

  it("codeBlock → Code:\\n{text}", () => {
    const { text } = serializeTiptapJsonForTest(
      doc({
        type: "codeBlock",
        content: [{ type: "text", text: "x = 1" }],
      }),
    );
    expect(text).toBe("Code:\nx = 1");
  });

  it("blockquote → lines prefixed with >", () => {
    const { text } = serializeTiptapJsonForTest(
      doc({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "อ้างอิง" }],
          },
        ],
      }),
    );
    expect(text).toBe("> อ้างอิง");
  });

  it("bulletList → - item", () => {
    const { text } = serializeTiptapJsonForTest(
      doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "แอปเปิล" }],
              },
            ],
          },
        ],
      }),
    );
    expect(text).toBe("- แอปเปิล");
  });

  it("orderedList → n. item", () => {
    const { text } = serializeTiptapJsonForTest(
      doc({
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "ขั้นแรก" }],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "ขั้นสอง" }],
              },
            ],
          },
        ],
      }),
    );
    expect(text).toBe("1. ขั้นแรก\n2. ขั้นสอง");
  });

  it("image → [Image] alt or [Image]", () => {
    const withAlt = serializeTiptapJsonForTest(
      doc({ type: "image", attrs: { alt: "รูปใบไม้" } }),
    );
    expect(withAlt.text).toBe("[Image] รูปใบไม้");

    const noAlt = serializeTiptapJsonForTest(
      doc({ type: "image", attrs: {} }),
    );
    expect(noAlt.text).toBe("[Image]");
  });

  it("formulaBlock → [Formula] latex from attrs (atom node)", () => {
    const withLatex = serializeTiptapJsonForTest(
      doc({
        type: "formulaBlock",
        attrs: { id: "f1", latex: "F = ma" },
      }),
    );
    expect(withLatex.text).toBe("[Formula] F = ma");

    const empty = serializeTiptapJsonForTest(
      doc({ type: "formulaBlock", attrs: { id: "f2", latex: "" } }),
    );
    expect(empty.text).toBe("[Formula]");
  });

  it("youtube → [Video] src", () => {
    const { text } = serializeTiptapJsonForTest(
      doc({
        type: "youtube",
        attrs: { src: "https://www.youtube.com/watch?v=abc123" },
      }),
    );
    expect(text).toBe("[Video] https://www.youtube.com/watch?v=abc123");
  });

  it("fabricCanvas → drawing placeholder", () => {
    const { text } = serializeTiptapJsonForTest(
      doc({ type: "fabricCanvas", attrs: { canvasData: "{...}" } }),
    );
    expect(text).toBe("[Drawing/diagram — visible only on the lesson page]");
  });

  it("table → one piped line per row", () => {
    const cell = (type: string, value: string) => ({
      type,
      content: [
        { type: "paragraph", content: [{ type: "text", text: value }] },
      ],
    });
    const { text } = serializeTiptapJsonForTest(
      doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [cell("tableHeader", "แรง"), cell("tableHeader", "หน่วย")],
          },
          {
            type: "tableRow",
            content: [cell("tableCell", "แรงโน้มถ่วง"), cell("tableCell", "นิวตัน")],
          },
        ],
      }),
    );
    expect(text).toBe("| แรง | หน่วย |\n| แรงโน้มถ่วง | นิวตัน |");
  });

  it("hardBreak → newline in inline text", () => {
    const { text } = serializeTiptapJsonForTest(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "บรรทัด1" },
          { type: "hardBreak" },
          { type: "text", text: "บรรทัด2" },
        ],
      }),
    );
    expect(text).toBe("บรรทัด1\nบรรทัด2");
  });

  it("QuestionAgent excluded from text", () => {
    const { text } = serializeTiptapJsonForTest(
      doc(
        {
          type: "paragraph",
          content: [{ type: "text", text: "เนื้อหา" }],
        },
        {
          type: "QuestionAgent",
          attrs: { id: "agent-1", title: "ถาม AI", chatHistory: [] },
        },
      ),
    );
    expect(text).toBe("เนื้อหา");
    expect(text).not.toContain("ถาม AI");
  });

  it("QuestionChoice emits placeholder and questions[] with guideAnswer", () => {
    const { text, questions } = serializeTiptapJsonForTest(
      doc({
        type: "QuestionChoice",
        attrs: {
          id: "q1",
          question: "เลือกข้อที่ถูก",
          choices: [
            { text: "A", correct: true },
            { text: "B", correct: false },
            { text: "C", correct: true },
          ],
          feedbackMode: "quick_check",
        },
      }),
    );
    expect(text).toContain("[คำถามที่ 1] เลือกข้อที่ถูก");
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      blockId: "q1",
      kind: "choice",
      guideAnswer: "A | C",
    });
  });

  it("QuestionWrite guideAnswer from attrs.answer", () => {
    const { questions } = serializeTiptapJsonForTest(
      doc({
        type: "QuestionWrite",
        attrs: {
          id: "w1",
          question: "อธิบาย",
          answer: "คำตอบครู",
          feedbackMode: "full_reflection",
        },
      }),
    );
    expect(questions[0].guideAnswer).toBe("คำตอบครู");
    expect(questions[0].kind).toBe("write");
  });

  it("QuestionBlankChoice guideAnswer from correctByBlank", () => {
    const { questions } = serializeTiptapJsonForTest(
      doc({
        type: "QuestionBlankChoice",
        attrs: {
          id: "bc1",
          template: "ใช้ [Q-0] และ [Q-1]",
          choices: ["น้ำ", "CO2", "หิน"],
          correctByBlank: [0, 1],
          feedbackMode: "quick_check",
        },
      }),
    );
    expect(questions[0].guideAnswer).toBe("น้ำ | CO2");
    expect(questions[0].kind).toBe("blank_choice");
  });

  it("QuestionBlankWrite guideAnswer from blankAnswers", () => {
    const { questions } = serializeTiptapJsonForTest(
      doc({
        type: "QuestionBlankWrite",
        attrs: {
          id: "bw1",
          template: "ผลลัพธ์ [Q-0]",
          blankAnswers: ["กลูโคส", "ออกซิเจน"],
          feedbackMode: "quick_check",
        },
      }),
    );
    expect(questions[0].guideAnswer).toBe("กลูโคส | ออกซิเจน");
    expect(questions[0].kind).toBe("blank_write");
  });

  it("malformed JSON → empty text and questions", () => {
    const { text, questions } = serializeTiptapJsonForTest("not-json{{{");
    expect(text).toBe("");
    expect(questions).toEqual([]);
  });

  it("unknown node type recurses into children", () => {
    const { text } = serializeTiptapJsonForTest(
      doc({
        type: "customWrapper",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "ข้างใน" }],
          },
        ],
      }),
    );
    expect(text).toBe("ข้างใน");
  });
});

describe("getLessonContext cache", () => {
  beforeEach(() => {
    clearLessonContextCache();
  });

  it("returns cached object until updatedAt changes", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    const id = lesson._id.toString();

    const first = await getLessonContext(id);
    const second = await getLessonContext(id);
    expect(first).toBe(second);

    await Content.findByIdAndUpdate(id, { title: "ชื่อใหม่" });
    const third = await getLessonContext(id);
    expect(third).not.toBe(first);
    expect(third?.title).toBe("ชื่อใหม่");
  });
});

describe("getLessonContext integration", () => {
  beforeEach(() => {
    clearLessonContextCache();
  });

  it("fixture lesson has text and 4 question nodes (agent excluded)", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    const ctx = await getLessonContext(lesson._id.toString());

    expect(ctx).not.toBeNull();
    expect(ctx!.text.length).toBeGreaterThan(0);
    // Fixture: QuestionChoice, QuestionWrite, QuestionBlankChoice, QuestionBlankWrite
    // QuestionAgent is excluded from questions[]
    expect(ctx!.questions).toHaveLength(4);
    expect(ctx!.text).toContain("ปอดของโลก");
    expect(ctx!.questions.some((q) => q.blockId === "q-choice-1")).toBe(true);
  });

  it("returns null for nonexistent contentId", async () => {
    const ctx = await getLessonContext(new Types.ObjectId().toString());
    expect(ctx).toBeNull();
  });

  it("agentSettings populated with defaults for docs without the field", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id);
    const ctx = await getLessonContext(lesson._id.toString());
    expect(ctx?.agentSettings).toEqual({
      persona_note: "",
      allow_direct_answers: false,
      scope: "lesson_plus_general",
      custom_guidelines: "",
    });
  });
});
