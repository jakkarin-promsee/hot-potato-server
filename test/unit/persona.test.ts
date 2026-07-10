import { describe, it, expect } from "vitest";
import {
  buildSystemInstruction,
  TUTOR_NAME,
} from "../../src/services/tutor/persona";
import type { LessonContext } from "../../src/services/lessonContext.service";

const sampleLesson: LessonContext = {
  contentId: "abc123",
  updatedAt: new Date(),
  title: "การสังเคราะห์แสง",
  accessType: "public",
  ownerId: "owner1",
  collaboratorIds: [],
  text: "พืชสร้างอาหารจากแสง",
  questions: [
    {
      blockId: "q-1",
      kind: "choice",
      question: "วัตถุดิบคืออะไร?",
      guideAnswer: "น้ำ | CO2",
      feedbackMode: "quick_check",
    },
  ],
};

describe("buildSystemInstruction", () => {
  it("1. includes tutor name and persona tripwires", () => {
    const sys = buildSystemInstruction({ lesson: sampleLesson });
    expect(sys).toContain(TUTOR_NAME);
    expect(sys).toContain("== YOUR CHARACTER ==");
    expect(sys).toContain("NEVER say the student is wrong");
    expect(sys).toContain("[SUGGESTIONS]");
  });

  it("2. includes lesson title, text, and question with guide answer", () => {
    const sys = buildSystemInstruction({ lesson: sampleLesson });
    expect(sys).toContain("== บทเรียน: การสังเคราะห์แสง ==");
    expect(sys).toContain("พืชสร้างอาหารจากแสง");
    expect(sys).toContain("[q-1] (choice) วัตถุดิบคืออะไร? | แนวคำตอบ: น้ำ | CO2");
  });

  it("3. omits memory section when memoryDigest absent", () => {
    const sys = buildSystemInstruction({ lesson: sampleLesson });
    expect(sys).not.toContain("== สิ่งที่รู้เกี่ยวกับเพื่อนคนนี้ ==");
  });

  it("4. includes memory section when memoryDigest present", () => {
    const sys = buildSystemInstruction({
      lesson: sampleLesson,
      memoryDigest: "ชอบฟุตบอล",
    });
    expect(sys).toContain("== สิ่งที่รู้เกี่ยวกับเพื่อนคนนี้ ==");
    expect(sys).toContain("ชอบฟุตบอล");
  });

  it("5. omits teacher note when absent", () => {
    const sys = buildSystemInstruction({ lesson: sampleLesson });
    expect(sys).not.toContain("== โน้ตจากคุณครู ==");
  });

  it("6. includes teacher note when present", () => {
    const sys = buildSystemInstruction({
      lesson: sampleLesson,
      teacherNote: "พูดเหมือนโค้ชกีฬา",
    });
    expect(sys).toContain("== โน้ตจากคุณครู ==");
    expect(sys).toContain("พูดเหมือนโค้ชกีฬา");
  });

  it("7. gates evaluation behind the feedback tag (intent rule)", () => {
    const sys = buildSystemInstruction({ lesson: sampleLesson });
    expect(sys).toContain("== เมื่อไหร่ประเมิน เมื่อไหร่คุยเฉยๆ (สำคัญมาก) ==");
    // Evaluation only when the exact feedback tag opens the message
    expect(sys).toContain(
      'ONLY when the latest message starts with the tag "[งานของเธอตอนนี้: ให้ฟีดแบ็กคำตอบของเพื่อน]"',
    );
    // Chit-chat / greetings must never be graded
    expect(sys).toContain("NEVER treat it as an answer");
    expect(sys).toContain("NEVER give an evaluation");
  });

  it("8. follow-up re-attempts are coached, not formally judged", () => {
    const sys = buildSystemInstruction({ lesson: sampleLesson });
    expect(sys).toContain("do not produce a formal verdict");
  });
});
