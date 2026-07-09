import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GenerativeModel } from "@google/generative-ai";
import {
  isTransientAIError,
  generateWithRetry,
} from "../../src/controllers/chat.controller";

// A minimal stand-in for the GenerativeModel — generateWithRetry only calls
// model.generateContent(prompt).
function fakeModel(fn: (prompt: string) => Promise<unknown>): GenerativeModel {
  return { generateContent: fn } as unknown as GenerativeModel;
}

describe("isTransientAIError", () => {
  it("1. classifies known transient failures as retryable", () => {
    for (const msg of [
      "fetch failed",
      "ECONNRESET",
      "socket hang up",
      "503 Service Unavailable",
      "429 rate limit",
      "model is overloaded",
    ]) {
      expect(isTransientAIError(new Error(msg)), msg).toBe(true);
    }
  });

  it("2. classifies fatal failures as non-retryable", () => {
    expect(isTransientAIError(new Error("400 Bad Request"))).toBe(false);
    expect(isTransientAIError(new Error("API key not valid"))).toBe(false);
  });
});

describe("generateWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("3. retries transient failures then resolves (2 fails + 1 success = 3 calls)", async () => {
    let n = 0;
    const gen = vi.fn(async () => {
      n += 1;
      if (n <= 2) throw new Error("fetch failed");
      return { response: { text: () => "ok" } };
    });
    const p = generateWithRetry(fakeModel(gen), "prompt");
    await vi.advanceTimersByTimeAsync(20000);
    await expect(p).resolves.toBeDefined();
    expect(gen).toHaveBeenCalledTimes(3);
  });

  it("4. gives up after exactly 5 calls on persistent transient failure", async () => {
    const gen = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const p = generateWithRetry(fakeModel(gen), "prompt");
    // Attach a rejection handler synchronously so the run doesn't flag an
    // unhandled rejection while timers advance.
    const settled = expect(p).rejects.toThrow("fetch failed");
    await vi.advanceTimersByTimeAsync(20000);
    await settled;
    expect(gen).toHaveBeenCalledTimes(5);
  });

  it("5. does not retry a non-transient failure (exactly 1 call)", async () => {
    const gen = vi.fn(async () => {
      throw new Error("invalid argument");
    });
    const p = generateWithRetry(fakeModel(gen), "prompt");
    const settled = expect(p).rejects.toThrow("invalid argument");
    await vi.advanceTimersByTimeAsync(20000);
    await settled;
    expect(gen).toHaveBeenCalledTimes(1);
  });
});
