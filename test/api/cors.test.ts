import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../src/app";

const ALLOWED = "https://app.example";
const savedCors = process.env.CORS_ORIGINS;

describe("CORS allowlist", () => {
  beforeAll(() => {
    process.env.CORS_ORIGINS = ALLOWED;
  });

  afterAll(() => {
    if (savedCors === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = savedCors;
  });

  it("allowed origin gets Access-Control-Allow-Origin", async () => {
    const res = await request(app)
      .get("/api/status/all")
      .set("Origin", ALLOWED);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("disallowed origin has no Access-Control-Allow-Origin (not a 500)", async () => {
    const res = await request(app)
      .get("/api/status/all")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("no Origin header still works", async () => {
    const res = await request(app).get("/api/status/all");
    expect(res.status).toBe(200);
  });

  it("OPTIONS preflight from allowed origin succeeds with CORS headers", async () => {
    const res = await request(app)
      .options("/api/status/all")
      .set("Origin", ALLOWED)
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBeLessThan(500);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("unconfigured CORS_ORIGINS reflects any origin (fail-open)", async () => {
    delete process.env.CORS_ORIGINS;
    const res = await request(app)
      .get("/api/status/all")
      .set("Origin", "https://any.example");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://any.example",
    );
    process.env.CORS_ORIGINS = ALLOWED;
  });
});
