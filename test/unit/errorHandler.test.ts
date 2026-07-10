import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { errorHandler } from "../../src/middlewares/error.middleware";

describe("errorHandler", () => {
  const savedNodeEnv = process.env.NODE_ENV;

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
});
