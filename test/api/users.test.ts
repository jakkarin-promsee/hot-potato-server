import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { seedUser } from "../helpers/seed";

describe("/api/users", () => {
  it("POST /api/users → 404 (route removed)", async () => {
    const res = await request(app)
      .post("/api/users")
      .send({ name: "Evil", email: "evil@test.local", password: "password-123" });
    expect(res.status).toBe(404);
  });

  it("GET /api/users anonymous → 401", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
    expect(res.body.forceRelogin).toBe(true);
  });

  it("GET /api/users as learner → 403", async () => {
    const { token } = await seedUser({ role: "learner" });
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("GET /api/users as admin → 200 without password hashes", async () => {
    const { token } = await seedUser({ role: "admin" });
    await seedUser({ role: "learner" });
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    for (const user of res.body) {
      expect(user.password).toBeUndefined();
    }
  });
});
