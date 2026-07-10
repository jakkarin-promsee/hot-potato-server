import { describe, it, expect } from "vitest";
import { parseTutorReply } from "../../src/services/tutor/parse";

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
