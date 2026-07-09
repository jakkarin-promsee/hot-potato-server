import { readFileSync } from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { User } from "../../src/models/user.model";
import { Content } from "../../src/models/content.model";

let seq = 0;

export async function seedUser(overrides: Record<string, unknown> = {}) {
  const user = await User.create({
    name: "Test Student",
    email: `student${++seq}@test.local`,
    password: "password-123", // hashed by the model's pre-save hook
    ...overrides,
  });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET as string, {
    expiresIn: "1h",
  });
  return { user, token };
}

export function loadLessonFixture(): Record<string, unknown> {
  const p = path.join(__dirname, "..", "fixtures", "lesson.json");
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    throw new Error(
      "Missing lesson fixture. Run: npx ts-node scripts/export-fixture.ts",
    );
  }
}

export async function seedLesson(
  ownerId: Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  const { _id, owner_id, ...rest } = loadLessonFixture();
  void _id;
  void owner_id;
  return Content.create({ ...rest, owner_id: ownerId, ...overrides });
}
