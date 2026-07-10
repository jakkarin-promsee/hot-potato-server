import { describe, it, expect } from "vitest";
import {
  PERSONALITIES_ENABLED,
  TUTOR_PERSONALITIES,
  resolvePersonality,
} from "../../src/services/tutor/personality";

describe("resolvePersonality", () => {
  it("1. valid id returns preset", () => {
    expect(resolvePersonality("sassy").id).toBe("sassy");
  });

  it("2. unknown id → default", () => {
    expect(resolvePersonality("unknown").id).toBe("default");
  });

  it("3. non-string → default", () => {
    expect(resolvePersonality(42).id).toBe("default");
  });

  it("4. pinned id list", () => {
    expect(TUTOR_PERSONALITIES.map((p) => p.id)).toEqual([
      "default",
      "gentle",
      "sassy",
      "detailed",
      "concise",
      "serious",
    ]);
  });
});

describe("PERSONALITIES_ENABLED kill switch", () => {
  it("is enabled by default in this tier", () => {
    expect(PERSONALITIES_ENABLED).toBe(true);
  });
});
