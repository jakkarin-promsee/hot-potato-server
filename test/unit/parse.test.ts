import { describe, it, expect } from "vitest";
import {
  parseTutorReply,
  REPORT_LABELS,
  stripInternalTags,
  stripReportLabels,
} from "../../src/services/tutor/parse";

describe("parseTutorReply", () => {
  it("1. happy path — 3 suggestions", () => {
    const raw = [
      "เยี่ยมเลย! ตรงที่เธอเชื่อมแสงกับอาหารนี่คิดได้ดีมาก",
      "",
      "[SUGGESTIONS]",
      "- แล้วน้ำมีบทบาทยังไง?",
      "- ทำไมต้องมีคลอโรฟิลล์?",
      "- ถ้าไม่มีแสงจะเกิดอะไรขึ้น?",
    ].join("\n");

    const result = parseTutorReply(raw);
    expect(result.reply).toBe(
      "เยี่ยมเลย! ตรงที่เธอเชื่อมแสงกับอาหารนี่คิดได้ดีมาก",
    );
    expect(result.suggestions).toEqual([
      "แล้วน้ำมีบทบาทยังไง?",
      "ทำไมต้องมีคลอโรฟิลล์?",
      "ถ้าไม่มีแสงจะเกิดอะไรขึ้น?",
    ]);
  });

  it("2. no marker → full text as reply, empty suggestions", () => {
    const raw = "สวัสดีจ้า วันนี้อยากเรียนเรื่องอะไร?";
    expect(parseTutorReply(raw)).toEqual({
      reply: raw,
      suggestions: [],
    });
  });

  it("3. marker mid-text as literal + real marker at end (last-occurrence rule)", () => {
    const raw = [
      "ในบทเรียนมีคำว่า [SUGGESTIONS] อยู่ด้วยนะ",
      "แต่จริงๆ แล้วนี่คือคำตอบ",
      "",
      "[SUGGESTIONS]",
      "- ข้อแรก",
      "- ข้อสอง",
    ].join("\n");

    const result = parseTutorReply(raw);
    expect(result.reply).toBe(
      "ในบทเรียนมีคำว่า [SUGGESTIONS] อยู่ด้วยนะ\nแต่จริงๆ แล้วนี่คือคำตอบ",
    );
    expect(result.suggestions).toEqual(["ข้อแรก", "ข้อสอง"]);
  });

  it("4. 5 suggestion lines → first 3 kept", () => {
    const raw = [
      "คำตอบสั้นๆ",
      "[SUGGESTIONS]",
      "- หนึ่ง",
      "- สอง",
      "- สาม",
      "- สี่",
      "- ห้า",
    ].join("\n");

    expect(parseTutorReply(raw).suggestions).toEqual(["หนึ่ง", "สอง", "สาม"]);
  });

  it("5. suggestion over 120 chars → truncated", () => {
    const long = "ก".repeat(150);
    const raw = `คำตอบ\n[SUGGESTIONS]\n- ${long}`;
    const result = parseTutorReply(raw);
    expect(result.suggestions[0]).toHaveLength(120);
    expect(result.suggestions[0]).toBe("ก".repeat(120));
  });

  it("6. whitespace around marker tolerated", () => {
    const raw = "คำตอบ\n  [SUGGESTIONS]  \n- คำถามต่อ?";
    const result = parseTutorReply(raw);
    expect(result.reply).toBe("คำตอบ");
    expect(result.suggestions).toEqual(["คำถามต่อ?"]);
  });

  it("7. marker but no valid - lines → empty suggestions, marker stripped", () => {
    const raw = "คำตอบจริง\n[SUGGESTIONS]\nไม่มี bullet\n* ไม่นับ";
    const result = parseTutorReply(raw);
    expect(result.reply).toBe("คำตอบจริง");
    expect(result.suggestions).toEqual([]);
  });
});

describe("stripReportLabels (0.B parse guard)", () => {
  it("1. pins the guarded label list", () => {
    expect(REPORT_LABELS).toContain("action plan");
    expect(REPORT_LABELS).toContain("สรุป");
    expect(REPORT_LABELS).toContain("คำแนะนำ(?:เพิ่มเติม)?");
  });

  it("2. strips a bold label at reply start, keeps the sentence", () => {
    expect(
      stripReportLabels("**Action Plan:** ครั้งต่อไปลองให้เหตุผลชัดๆ นะ"),
    ).toBe("ครั้งต่อไปลองให้เหตุผลชัดๆ นะ");
  });

  it("3. strips a plain Thai label at a paragraph start mid-reply", () => {
    const raw = ["ชอบคำตอบเธอมากเลย", "", "สรุป: เธอเข้าใจแก่นแล้ว"].join("\n");
    expect(stripReportLabels(raw)).toBe(
      ["ชอบคำตอบเธอมากเลย", "", "เธอเข้าใจแก่นแล้ว"].join("\n"),
    );
  });

  it("4. drops a label-only line entirely", () => {
    const raw = ["**ขั้นตอนต่อไป:**", "ลองวาดรูปประกอบดูนะ"].join("\n");
    expect(stripReportLabels(raw)).toBe("ลองวาดรูปประกอบดูนะ");
  });

  it("5. leaves legitimate mid-sentence bold untouched", () => {
    const raw = "เรื่องนี้ **สำคัญมาก** เลยนะ ลองคิดต่อดู";
    expect(stripReportLabels(raw)).toBe(raw);
  });

  it("6. never strips prose that merely starts with a label word (no colon)", () => {
    for (const raw of [
      "สรุปแล้วเธอเข้าใจถูกต้องเลย",
      "แผนของเราคือค่อยๆ ไล่ทีละข้อ",
      "คำแนะนำจากครูในบทเรียนก็บอกแบบนี้เหมือนกัน",
    ]) {
      expect(stripReportLabels(raw)).toBe(raw);
    }
  });

  it("7. covers English variants: Next steps / Feedback / Summary", () => {
    const raw = [
      "Next steps: อ่านหน้า 5 ต่อ",
      "**Feedback**: ตรงเชื่อมเหตุผลดีมาก",
      "Summary: ครบทุกประเด็น",
    ].join("\n");
    expect(stripReportLabels(raw)).toBe(
      ["อ่านหน้า 5 ต่อ", "ตรงเชื่อมเหตุผลดีมาก", "ครบทุกประเด็น"].join("\n"),
    );
  });

  it("8. parseTutorReply applies the guard on both marker paths", () => {
    const withMarker = [
      "**Action Plan:** ลองใหม่อีกครั้งนะ",
      "[SUGGESTIONS]",
      "- ถามต่อได้ไหม?",
    ].join("\n");
    expect(parseTutorReply(withMarker).reply).toBe("ลองใหม่อีกครั้งนะ");

    const withoutMarker = "สรุป: เก่งมากเลยวันนี้";
    expect(parseTutorReply(withoutMarker).reply).toBe("เก่งมากเลยวันนี้");
  });
});

describe("stripInternalTags (tag-echo leak guard)", () => {
  it("1. strips a leaked feedback task tag line at reply start", () => {
    const raw = [
      "[งานของเธอตอนนี้: ให้ฟีดแบ็กคำตอบของเพื่อน]",
      "เยี่ยมเลย! ไอเดียเรื่องต้นไม้นี่คิดได้ดีมาก",
    ].join("\n");
    expect(stripInternalTags(raw)).toBe(
      "เยี่ยมเลย! ไอเดียเรื่องต้นไม้นี่คิดได้ดีมาก",
    );
  });

  it("2. strips a bolded tag sharing a line with content", () => {
    expect(
      stripInternalTags(
        "**[งานของเธอตอนนี้: ให้ฟีดแบ็กคำตอบของเพื่อน]** เก่งมากเลยเพื่อน",
      ),
    ).toBe("เก่งมากเลยเพื่อน");
  });

  it("3. strips reading-position and followup-question tags", () => {
    const raw = [
      "[ตอนนี้เพื่อนกำลังอ่าน/อยู่แถวส่วนนี้ของบทเรียน: แรงเสียดทาน]",
      "[คำถามที่คุยกันอยู่: แรงคืออะไร?]",
      "แรงเสียดทานคือแรงต้านการเคลื่อนที่จ้า",
    ].join("\n");
    expect(stripInternalTags(raw)).toBe(
      "แรงเสียดทานคือแรงต้านการเคลื่อนที่จ้า",
    );
  });

  it("4. leaves normal bracket text untouched", () => {
    for (const raw of [
      "[Formula] E = mc^2 หมายถึงอะไรน่ะเหรอ?",
      "ในบทเรียนเขียน [คำถามที่ 1] ไว้ต้นเรื่องเลยนะ",
      "ลองดูตรง [Image] ใบไม้ ประกอบนะ",
    ]) {
      expect(stripInternalTags(raw)).toBe(raw);
    }
  });

  it("5. parseTutorReply applies the guard before splitting suggestions", () => {
    const raw = [
      "[งานของเธอตอนนี้: ให้ฟีดแบ็กคำตอบของเพื่อน]",
      "เยี่ยมเลย!",
      "[SUGGESTIONS]",
      "- ถามต่อได้ไหม?",
    ].join("\n");
    const result = parseTutorReply(raw);
    expect(result.reply).toBe("เยี่ยมเลย!");
    expect(result.suggestions).toEqual(["ถามต่อได้ไหม?"]);
  });
});

describe("lenient [SUGGESTIONS] marker", () => {
  it("1. bold marker **[SUGGESTIONS]** still splits", () => {
    const raw = "คำตอบ\n**[SUGGESTIONS]**\n- คำถามต่อ?";
    const result = parseTutorReply(raw);
    expect(result.reply).toBe("คำตอบ");
    expect(result.suggestions).toEqual(["คำถามต่อ?"]);
  });

  it("2. trailing colon [SUGGESTIONS]: still splits", () => {
    const raw = "คำตอบ\n[SUGGESTIONS]:\n- คำถามต่อ?";
    const result = parseTutorReply(raw);
    expect(result.reply).toBe("คำตอบ");
    expect(result.suggestions).toEqual(["คำถามต่อ?"]);
  });

  it("3. lowercase [suggestions] still splits", () => {
    const raw = "คำตอบ\n[suggestions]\n- คำถามต่อ?";
    const result = parseTutorReply(raw);
    expect(result.reply).toBe("คำตอบ");
    expect(result.suggestions).toEqual(["คำถามต่อ?"]);
  });

  it("4. marker embedded in prose is still treated as literal text", () => {
    const raw = "คำว่า [SUGGESTIONS] โผล่ในบทเรียนได้นะ";
    expect(parseTutorReply(raw)).toEqual({ reply: raw, suggestions: [] });
  });
});
