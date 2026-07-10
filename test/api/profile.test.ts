import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { seedUser, seedLesson } from "../helpers/seed";
import { UserData } from "../../src/models/user_data.model";
import { Content } from "../../src/models/content.model";

describe("GET /api/users/me/profile", () => {
  it("1. without token → 401 with structured body", async () => {
    const res = await request(app).get("/api/users/me/profile");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      message: "No token, authorization denied",
      code: "TOKEN_MISSING",
      forceRelogin: true,
      clearToken: true,
    });
  });

  it("2. with token, no UserData row → defaults without creating a row", async () => {
    const { token } = await seedUser();
    const res = await request(app)
      .get("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual({
      avatar: "",
      bio: "",
      nickname: "",
    });
    expect(res.body.user.name).toBe("Test Student");
    expect(res.body.user.email).toMatch(/student\d+@test\.local/);

    const count = await UserData.countDocuments();
    expect(count).toBe(0);
  });
});

describe("PUT /api/users/me/profile", () => {
  it("3. PUT bio + nickname → upserts row; GET returns values", async () => {
    const { token } = await seedUser();
    const res = await request(app)
      .put("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ bio: "Hello world", nickname: "Tester" });

    expect(res.status).toBe(200);
    expect(res.body.profile.bio).toBe("Hello world");
    expect(res.body.profile.nickname).toBe("Tester");

    const getRes = await request(app)
      .get("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.body.profile.bio).toBe("Hello world");
    expect(getRes.body.profile.nickname).toBe("Tester");
  });

  it("4. partial PUT bio only → nickname untouched", async () => {
    const { token } = await seedUser();
    await request(app)
      .put("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ bio: "First", nickname: "Nick" });

    const res = await request(app)
      .put("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ bio: "Updated bio" });

    expect(res.status).toBe(200);
    expect(res.body.profile.bio).toBe("Updated bio");
    expect(res.body.profile.nickname).toBe("Nick");
  });

  it("5. validation 400s", async () => {
    const { token } = await seedUser();

    const empty = await request(app)
      .put("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(empty.status).toBe(400);

    const blankName = await request(app)
      .put("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "  " });
    expect(blankName.status).toBe(400);

    const longBio = await request(app)
      .put("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ bio: "x".repeat(501) });
    expect(longBio.status).toBe(400);

    const badAvatar = await request(app)
      .put("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ avatar: "http://evil.com/x.png" });
    expect(badAvatar.status).toBe(400);
  });

  it("6. rename propagates author_name and collaborator_names", async () => {
    const { user, token } = await seedUser({ name: "Old Name" });
    const owned = await seedLesson(user._id, { author_name: "Old Name" });

    const { user: owner2 } = await seedUser({ name: "Owner Two" });
    const collabLesson = await seedLesson(owner2._id, {
      collaborators: [user._id],
      author_name: "Owner Two",
      collaborator_names: ["Old Name"],
    });

    const res = await request(app)
      .put("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("New Name");

    const ownedFresh = await Content.findById(owned._id).lean();
    expect(ownedFresh?.author_name).toBe("New Name");

    const collabFresh = await Content.findById(collabLesson._id).lean();
    expect(collabFresh?.collaborator_names).toContain("New Name");
  });
});
