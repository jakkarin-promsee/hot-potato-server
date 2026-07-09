import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import app from "../../src/app";
import { seedUser } from "../helpers/seed";

describe("/api/content-answer", () => {
  it("1. first visit (logged in) → 200 with empty map", async () => {
    const { token } = await seedUser();
    const contentId = new Types.ObjectId().toString();
    const res = await request(app)
      .get(`/api/content-answer/${contentId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it("2. PUT one answer then GET roundtrips the value", async () => {
    const { token } = await seedUser();
    const contentId = new Types.ObjectId().toString();
    const answer = { selected: [1], submitted: true };
    const put = await request(app)
      .put(`/api/content-answer/${contentId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ blockId: "b1", answer });
    expect(put.status).toBe(200);

    const get = await request(app)
      .get(`/api/content-answer/${contentId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.b1).toEqual(answer);
  });

  it("3. PUT without blockId → 400", async () => {
    const { token } = await seedUser();
    const contentId = new Types.ObjectId().toString();
    const res = await request(app)
      .put(`/api/content-answer/${contentId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ answer: { x: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("blockId is required");
  });

  it("4. bulk PUT replaces the whole map", async () => {
    const { token } = await seedUser();
    const contentId = new Types.ObjectId().toString();
    await request(app)
      .put(`/api/content-answer/${contentId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ blockId: "old", answer: { keep: false } });

    const bulk = await request(app)
      .put(`/api/content-answer/${contentId}/bulk`)
      .set("Authorization", `Bearer ${token}`)
      .send({ answers: { a: { v: 1 }, b: { v: 2 } } });
    expect(bulk.status).toBe(200); // characterized 2026-07-09

    const get = await request(app)
      .get(`/api/content-answer/${contentId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.body.a).toEqual({ v: 1 });
    expect(get.body.b).toEqual({ v: 2 });
    expect(get.body.old).toBeUndefined();
  });

  it("5. any request without a token → 401 TOKEN_MISSING", async () => {
    const contentId = new Types.ObjectId().toString();
    const res = await request(app).get(`/api/content-answer/${contentId}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_MISSING");
  });
});
