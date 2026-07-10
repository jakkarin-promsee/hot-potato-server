import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { errorHandler } from "../../src/middlewares/error.middleware";
import {
  getErrorSummary,
  getErrorSummaryDetailed,
  resetObservabilityForTests,
} from "../../src/services/observability.service";

describe("errorHandler", () => {
  const savedNodeEnv = process.env.NODE_ENV;

  beforeEach(() => resetObservabilityForTests());

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  function mockRes() {
    const res = {
      statusCode: 0,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res;
  }

  it("production → generic message, no internal detail", () => {
    process.env.NODE_ENV = "production";
    const res = mockRes();
    const next = () => {};
    errorHandler(
      new Error("secret detail"),
      {} as never,
      res as never,
      next,
    );
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ message: "Internal Server Error" });
  });

  it("non-production → echoes err.message", () => {
    process.env.NODE_ENV = "test";
    const res = mockRes();
    errorHandler(
      new Error("secret detail"),
      {} as never,
      res as never,
      () => {},
    );
    expect(res.body).toEqual({ message: "secret detail" });
  });

  it("records the error into the ring buffer (route without query, no message)", () => {
    process.env.NODE_ENV = "test";
    const res = mockRes();
    errorHandler(
      new Error("student wrote something private"),
      { method: "POST", originalUrl: "/api/content/load?id=abc" } as never,
      res as never,
      () => {},
    );
    const summary = getErrorSummary();
    expect(summary.count_since_boot).toBe(1);
    expect(summary.recent[0]).toMatchObject({
      method: "POST",
      route: "/api/content/load",
      status: 500,
    });
    expect((summary.recent[0] as Record<string, unknown>).name).toBeUndefined();
    expect(
      JSON.stringify(getErrorSummaryDetailed()),
    ).not.toContain("student wrote something private");
  });

  it("does not crash when req is an empty object (legacy test shape)", () => {
    process.env.NODE_ENV = "test";
    const res = mockRes();
    errorHandler(new Error("x"), {} as never, res as never, () => {});
    expect(getErrorSummary().recent[0].method).toBe("UNKNOWN");
  });
});
