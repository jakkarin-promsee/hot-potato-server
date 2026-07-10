import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { seedUser } from "../helpers/seed";

describe("/api/status", () => {
  it("GET /api/status/all anonymous → 200; database check has no host/db_name", async () => {
    const res = await request(app).get("/api/status/all");
    expect(res.status).toBe(200);
    expect(res.body.checks.database.host).toBeUndefined();
    expect(res.body.checks.database.db_name).toBeUndefined();
    expect(res.body.checks.database.connection).toBeDefined();
  });

  it("GET /api/status/database anonymous → no host/port/db_name", async () => {
    const res = await request(app).get("/api/status/database");
    expect([200, 503]).toContain(res.status);
    expect(res.body.host).toBeUndefined();
    expect(res.body.port).toBeUndefined();
    expect(res.body.db_name).toBeUndefined();
    expect(res.body.connection).toBeDefined();
  });

  it("GET /api/status/ as learner → 403; as admin → 200", async () => {
    const { token: learnerToken } = await seedUser({ role: "learner" });
    const learnerRes = await request(app)
      .get("/api/status/")
      .set("Authorization", `Bearer ${learnerToken}`);
    expect(learnerRes.status).toBe(403);

    const { token: adminToken } = await seedUser({ role: "admin" });
    const adminRes = await request(app)
      .get("/api/status/")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.status).toBe("ok");
  });

  it("GET /api/status/env reports all required server variables", async () => {
    const res = await request(app).get("/api/status/env");
    expect(res.status).toBe(200);
    expect(res.body.variables.map((v: { key: string }) => v.key)).toEqual([
      "MONGO_URI",
      "JWT_SECRET",
      "JWT_EXPIRES_IN",
      "GEMINI_API_KEY",
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_UPLOAD_PRESET",
    ]);
    expect(res.body.variables.every((v: { loaded: boolean }) => v.loaded)).toBe(
      true,
    );
  });
});
