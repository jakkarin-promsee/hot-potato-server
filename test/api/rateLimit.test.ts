import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { optionalAuth } from "../../src/middlewares/auth.middleware";
import {
  createAuthRateLimiter,
  createChatRateLimiter,
} from "../../src/middlewares/rateLimit.middleware";
import { seedUser } from "../helpers/seed";

describe("chat rate limiting", () => {
  let app: express.Express;
  let token: string;

  beforeAll(async () => {
    process.env.AI_RATELIMIT_PER_10MIN = "3";
    const seeded = await seedUser();
    token = seeded.token;

    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    const handler = vi.fn((_req, res) => res.status(200).json({ answer: "ok" }));
    app.post("/api/chat/tutor", optionalAuth, ...createChatRateLimiter(), handler);
  });

  it("returns 429 after the 10-min limit and keeps serving other IPs/users", async () => {
    const anonIp = "203.0.113.50";

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/chat/tutor")
        .set("X-Forwarded-For", anonIp)
        .send({ prompt: `hi-${i}` });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/api/chat/tutor")
      .set("X-Forwarded-For", anonIp)
      .send({ prompt: "one-too-many" });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ message: "Too many requests" });

    const authed = await request(app)
      .post("/api/chat/tutor")
      .set("X-Forwarded-For", anonIp)
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "logged-in ok" });
    expect(authed.status).toBe(200);
  });
});

describe("auth rate limiting", () => {
  let app: express.Express;

  beforeAll(() => {
    process.env.AUTH_RATELIMIT_PER_10MIN = "3";
    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    const handler = vi.fn((_req, res) => res.status(200).json({ ok: true }));
    app.post("/api/auth/login", createAuthRateLimiter(), handler);
  });

  it("returns 429 after the 10-min auth limit", async () => {
    const ip = "203.0.113.99";

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", ip)
        .send({ email: "a@test.local", password: "x" });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ email: "a@test.local", password: "x" });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      message: "Too many attempts, please try again later",
    });
  });
});
