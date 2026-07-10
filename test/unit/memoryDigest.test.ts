import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import type { IStudentMemory } from "../../src/models/student_memory.model";
import { buildMemoryDigest } from "../../src/services/tutor/memory";

function makeMemory(
  overrides: Partial<IStudentMemory> = {},
): IStudentMemory {
  return {
    user_id: new Types.ObjectId(),
    interests: [],
    strengths: [],
    growth_areas: [],
    preferences: [],
    recent_topics: [],
    ...overrides,
  } as IStudentMemory;
}

describe("buildMemoryDigest", () => {
  it("null → empty string", () => {
    expect(buildMemoryDigest(null)).toBe("");
  });

  it("empty doc → empty string", () => {
    expect(buildMemoryDigest(makeMemory())).toBe("");
  });

  it("full doc → all lines present and joined correctly", () => {
    const mem = makeMemory({
      interests: ["ฟุตบอล", "วิทย์"],
      strengths: ["เชื่อมโยงเหตุผล"],
      growth_areas: ["เศษส่วน"],
      preferences: ["คำอธิบายสั้นๆ"],
      recent_topics: [
        {
          content_id: new Types.ObjectId(),
          summary: "การสังเคราะห์แสง",
          updatedAt: new Date("2026-07-10T10:00:00Z"),
        },
        {
          content_id: new Types.ObjectId(),
          summary: "พลังงาน",
          updatedAt: new Date("2026-07-09T10:00:00Z"),
        },
      ],
    });
    const digest = buildMemoryDigest(mem);
    expect(digest).toContain("ความสนใจ: ฟุตบอล, วิทย์");
    expect(digest).toContain("จุดแข็งที่เคยเห็น: เชื่อมโยงเหตุผล");
    expect(digest).toContain("กำลังฝึก: เศษส่วน");
    expect(digest).toContain("สไตล์ที่ชอบ: คำอธิบายสั้นๆ");
    expect(digest).toContain("เพิ่งเรียน: การสังเคราะห์แสง; พลังงาน");
  });

  it("empty arrays omit their lines", () => {
    const mem = makeMemory({
      interests: ["อ่านนิยาย"],
      strengths: [],
      growth_areas: [],
      preferences: [],
    });
    const digest = buildMemoryDigest(mem);
    expect(digest).toBe("ความสนใจ: อ่านนิยาย");
    expect(digest).not.toContain("จุดแข็ง");
    expect(digest).not.toContain("กำลังฝึก");
    expect(digest).not.toContain("สไตล์ที่ชอบ");
  });

  it(">600 chars → truncated", () => {
    const long = "ก".repeat(200);
    const mem = makeMemory({
      interests: [long, long, long],
      strengths: [long],
    });
    const digest = buildMemoryDigest(mem);
    expect(digest.length).toBeLessThanOrEqual(600);
    expect(digest.length).toBe(600);
  });
});
