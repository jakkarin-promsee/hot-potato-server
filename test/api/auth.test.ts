import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import app from "../../src/app";
import { seedUser } from "../helpers/seed";

const validUser = {
  name: "Alice",
  email: "alice@test.local",
  password: "password-123",
};

describe("POST /api/auth/register", () => {
  it("1. creates a user and returns a token, without the password", async () => {
    const res = await request(app).post("/api/auth/register").send(validUser);
    expect(res.status).toBe(201); // characterized 2026-07-09
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toBeTruthy();
    expect(res.body.user.password).toBeUndefined();
  });

  it("2. rejects a duplicate email", async () => {
    await request(app).post("/api/auth/register").send(validUser);
    const res = await request(app).post("/api/auth/register").send(validUser);
    expect(res.status).toBe(400); // characterized 2026-07-09
    expect(res.body.message).toBe("Email already in use");
  });
});

describe("POST /api/auth/login", () => {
  it("3. logs in with correct credentials", async () => {
    await request(app).post("/api/auth/register").send(validUser);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: validUser.email, password: validUser.password });
    expect(res.status).toBe(200); // characterized 2026-07-09
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toBeTruthy();
  });

  it("4. rejects a wrong password", async () => {
    await request(app).post("/api/auth/register").send(validUser);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: validUser.email, password: "wrong-password" });
    expect(res.status).toBe(401); // characterized 2026-07-09
    expect(res.body.message).toBe("Invalid email or password");
  });
});

// Cases 5-8 are the client auto-logout contract — the most important here.
describe("GET /api/auth/recheck (structured-401 contract)", () => {
  it("5. no Authorization header → 401 TOKEN_MISSING with exact body", async () => {
    const res = await request(app).get("/api/auth/recheck");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      message: "No token, authorization denied",
      code: "TOKEN_MISSING",
      forceRelogin: true,
      clearToken: true,
    });
  });

  it("6. expired token → 401 TOKEN_EXPIRED, forceRelogin true", async () => {
    const { user } = await seedUser();
    const expired = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET as string,
      { expiresIn: "-1s" },
    );
    const res = await request(app)
      .get("/api/auth/recheck")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
    expect(res.body.forceRelogin).toBe(true);
  });

  it("7. garbage token → 401 TOKEN_INVALID", async () => {
    const res = await request(app)
      .get("/api/auth/recheck")
      .set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_INVALID");
  });

  it("8. valid token for a deleted user → 401 USER_NOT_FOUND", async () => {
    const { token, user } = await seedUser();
    const { User } = await import("../../src/models/user.model");
    await User.deleteOne({ _id: user._id });
    const res = await request(app)
      .get("/api/auth/recheck")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("USER_NOT_FOUND");
  });

  it("9. valid token → 200 with a fresh user", async () => {
    const { token, user } = await seedUser();
    const res = await request(app)
      .get("/api/auth/recheck")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200); // characterized 2026-07-09
    expect(res.body.user.email).toBe(user.email);
  });
});

// Sanity: an obviously-invalid ObjectId in a token still fails closed.
it("garbage id in a well-formed token is handled gracefully", async () => {
  const token = jwt.sign(
    { id: new Types.ObjectId().toString() },
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" },
  );
  const res = await request(app)
    .get("/api/auth/recheck")
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(401);
  expect(res.body.code).toBe("USER_NOT_FOUND");
});
