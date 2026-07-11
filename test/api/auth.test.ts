import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";

const { mockGenerateContent, mockVerifyIdToken } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(async () => ({ text: "MOCK_AI_REPLY" })),
  mockVerifyIdToken: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = mockVerifyIdToken;
  },
}));

import app from "../../src/app";
import { seedUser, seedLesson } from "../helpers/seed";

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

  it("2b. rejects a password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...validUser, email: "short@test.local", password: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Password must be at least 8 characters");
  });

  it("2c. rejects missing name", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "noname@test.local", password: "password-123" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Name, email and password are required");
  });

  it("2d. ignores role in body — always creates learner", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        ...validUser,
        email: "role-hack@test.local",
        role: "admin",
      });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("learner");

    const { User } = await import("../../src/models/user.model");
    const user = await User.findOne({ email: "role-hack@test.local" });
    expect(user?.role).toBe("learner");
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

describe("POST /api/auth/google", () => {
  const googleTicket = (overrides: Record<string, unknown> = {}) => ({
    getPayload: () => ({
      sub: "google-sub-1",
      email: "google.user@test.local",
      email_verified: true,
      name: "Google User",
      ...overrides,
    }),
  });

  const signInWithGoogle = (overrides: Record<string, unknown> = {}) => {
    mockVerifyIdToken.mockResolvedValueOnce(googleTicket(overrides));
    return request(app)
      .post("/api/auth/google")
      .send({ credential: "fake-google-jwt" });
  };

  it("10. missing credential → 400", async () => {
    const res = await request(app).post("/api/auth/google").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Google credential is required");
  });

  it("11. rejected verification → 401", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("bad token"));
    const res = await request(app)
      .post("/api/auth/google")
      .send({ credential: "garbage" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid Google credential");
  });

  it("12. unverified Google email → 401", async () => {
    const res = await signInWithGoogle({ email_verified: false });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid Google credential");
  });

  it("13. creates a passwordless learner on first sign-in", async () => {
    const res = await signInWithGoogle();
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe("learner");
    expect(res.body.user.email).toBe("google.user@test.local");

    const { User } = await import("../../src/models/user.model");
    const user = await User.findOne({ email: "google.user@test.local" });
    expect(user?.googleId).toBe("google-sub-1");
    expect(user?.password).toBeUndefined();
  });

  it("14. second sign-in reuses the same account", async () => {
    await signInWithGoogle();
    const res = await signInWithGoogle();
    expect(res.status).toBe(200);

    const { User } = await import("../../src/models/user.model");
    expect(
      await User.countDocuments({ email: "google.user@test.local" }),
    ).toBe(1);
  });

  it("15. auto-links an existing password account with the same email", async () => {
    await request(app).post("/api/auth/register").send(validUser);
    const res = await signInWithGoogle({ email: validUser.email });
    expect(res.status).toBe(200);

    const { User } = await import("../../src/models/user.model");
    const user = await User.findOne({ email: validUser.email });
    expect(user?.googleId).toBe("google-sub-1");

    // Password login must still work after linking.
    const pwRes = await request(app)
      .post("/api/auth/login")
      .send({ email: validUser.email, password: validUser.password });
    expect(pwRes.status).toBe(200);
  });

  it("16. blocked Google account → 403", async () => {
    await signInWithGoogle();
    const { User } = await import("../../src/models/user.model");
    await User.updateOne(
      { email: "google.user@test.local" },
      { $set: { status: "blocked" } },
    );

    const res = await signInWithGoogle();
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      "Your account has been suspended or blocked",
    );
  });

  it("17. password login on a Google-only account points at the button", async () => {
    await signInWithGoogle();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "google.user@test.local", password: "whatever-123" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(
      "This account uses Google sign-in — use the Google button",
    );
  });

  it("18. change-password on a Google-only account → 400", async () => {
    const googleRes = await signInWithGoogle();
    const res = await request(app)
      .put("/api/auth/change-password")
      .set("Authorization", `Bearer ${googleRes.body.token}`)
      .send({ currentPassword: "whatever-123", newPassword: "new-password-1" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "This account signs in with Google and has no password",
    );
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

describe("account status enforcement", () => {
  it("blocked user on protect route → 401 ACCOUNT_INACTIVE", async () => {
    const { token, user } = await seedUser();
    const { User } = await import("../../src/models/user.model");
    await User.updateOne({ _id: user._id }, { $set: { status: "blocked" } });

    const res = await request(app)
      .get("/api/auth/recheck")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      code: "ACCOUNT_INACTIVE",
      forceRelogin: true,
      clearToken: true,
      message: "Your account has been suspended or blocked",
    });
  });

  it("suspended user on POST /api/chat/tutor → 200 (optionalAuth degrades to anonymous)", async () => {
    const { token, user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const { User } = await import("../../src/models/user.model");
    await User.updateOne({ _id: user._id }, { $set: { status: "suspended" } });

    const res = await request(app)
      .post("/api/chat/tutor")
      .set("Authorization", `Bearer ${token}`)
      .send({
        contentId: lesson._id.toString(),
        mode: "free_chat",
        message: "สวัสดี",
      });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBeTruthy();
  });
});
