import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import app from "../../src/app";
import { seedUser, seedLesson } from "../helpers/seed";

describe("GET /api/content/load (Golden Rule 2: anonymous reads public content)", () => {
  it("1. public + anonymous → 200 with tiptap_json", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "public" });
    const res = await request(app).get(`/api/content/load?id=${lesson._id}`);
    expect(res.status).toBe(200);
    expect(res.body.tiptap_json).toBeTruthy();
  });

  it("2. link-only + anonymous → 200", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "link-only" });
    const res = await request(app).get(`/api/content/load?id=${lesson._id}`);
    expect(res.status).toBe(200);
  });

  it("3. private + anonymous → 401 (login required)", async () => {
    const { user } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "private" });
    const res = await request(app).get(`/api/content/load?id=${lesson._id}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Login required to view this content");
  });

  it("4. private + stranger → 403", async () => {
    const { user } = await seedUser();
    const { token: strangerToken } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "private" });
    const res = await request(app)
      .get(`/api/content/load?id=${lesson._id}`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("No permission to view this content");
  });

  it("5. private + owner → 200", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "private" });
    const res = await request(app)
      .get(`/api/content/load?id=${lesson._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("6. private + collaborator → 200", async () => {
    const { user } = await seedUser();
    const { user: collab, token: collabToken } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "private" });
    lesson.collaborators.push(collab._id);
    await lesson.save();
    const res = await request(app)
      .get(`/api/content/load?id=${lesson._id}`)
      .set("Authorization", `Bearer ${collabToken}`);
    expect(res.status).toBe(200);
  });

  it("7. nonexistent id → 404", async () => {
    const missing = new Types.ObjectId().toString();
    const res = await request(app).get(`/api/content/load?id=${missing}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Content not found");
  });
});

describe("POST /api/content/create", () => {
  it("8. with token → 201 { content_id }; without token → 401 TOKEN_MISSING", async () => {
    const { token } = await seedUser();
    const ok = await request(app)
      .post("/api/content/create")
      .set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(201);
    expect(ok.body.content_id).toBeTruthy();

    const anon = await request(app).post("/api/content/create");
    expect(anon.status).toBe(401);
    expect(anon.body.code).toBe("TOKEN_MISSING");
  });
});

describe("PUT /api/content/:id", () => {
  it("9. stale clientUpdatedAt → 409 with serverUpdatedAt", async () => {
    const { user, token } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "private" });
    const res = await request(app)
      .put(`/api/content/${lesson._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ clientUpdatedAt: new Date(0).toISOString(), title: "New" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      "Conflict: a newer version exists on the server.",
    );
    expect(res.body.serverUpdatedAt).toBeTruthy();
  });

  it("10. update by non-owner/non-collaborator → 403", async () => {
    const { user } = await seedUser();
    const { token: strangerToken } = await seedUser();
    const lesson = await seedLesson(user._id, { access_type: "private" });
    const res = await request(app)
      .put(`/api/content/${lesson._id}`)
      .set("Authorization", `Bearer ${strangerToken}`)
      .send({ title: "Hijack" });
    expect(res.status).toBe(403);
  });
});