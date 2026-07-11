import { describe, it, expect, vi } from "vitest";
import {
  askJson,
  CreatorAiInvalidError,
  parseJsonLoose,
} from "../../src/services/creator/parse";

describe("parseJsonLoose", () => {
  it("parses clean JSON", () => {
    expect(parseJsonLoose('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses fenced ```json output", () => {
    const raw = '```json\n{"latex": "\\\\frac{1}{2}"}\n```';
    expect(parseJsonLoose(raw)).toEqual({ latex: "\\frac{1}{2}" });
  });

  it("parses JSON surrounded by prose", () => {
    const raw = 'นี่คือคำตอบ: {"title": "บทเรียน"} หวังว่าจะช่วยได้';
    expect(parseJsonLoose(raw)).toEqual({ title: "บทเรียน" });
  });

  it("returns null for garbage", () => {
    expect(parseJsonLoose("ขอโทษนะ ฉันตอบเป็น JSON ไม่ได้")).toBeNull();
    expect(parseJsonLoose("")).toBeNull();
  });
});

describe("askJson", () => {
  const validate = (parsed: unknown) => {
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = (parsed as { value?: unknown }).value;
    return typeof v === "string" ? { value: v } : null;
  };

  it("returns on first valid answer without retrying", async () => {
    const call = vi.fn(async () => '{"value": "ok"}');
    const result = await askJson(call, "prompt", validate);
    expect(result).toEqual({ value: "ok" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once on garbage, appending the retry note", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce("not json at all")
      .mockResolvedValueOnce('{"value": "second try"}');
    const result = await askJson(call, "prompt", validate);
    expect(result).toEqual({ value: "second try" });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][0]).toContain("prompt");
    expect(call.mock.calls[1][0]).toContain("ไม่ใช่ JSON ที่ valid");
  });

  it("retries when JSON parses but validation rejects it", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce('{"wrong": true}')
      .mockResolvedValueOnce('{"value": "fixed"}');
    const result = await askJson(call, "prompt", validate);
    expect(result).toEqual({ value: "fixed" });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("throws CreatorAiInvalidError after two failures", async () => {
    const call = vi.fn(async () => "garbage");
    await expect(askJson(call, "prompt", validate)).rejects.toBeInstanceOf(
      CreatorAiInvalidError,
    );
    expect(call).toHaveBeenCalledTimes(2);
  });
});
