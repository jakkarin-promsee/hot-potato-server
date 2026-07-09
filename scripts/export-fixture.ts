/**
 * Dump the real test lesson from MongoDB into test/fixtures/lesson.json so the
 * offline test suite can seed a real authored lesson.
 *
 * Run once by the owner, with a real server/.env present:
 *   npx ts-node scripts/export-fixture.ts
 *
 * Safe to re-run — it overwrites the committed synthetic fixture with real data.
 * Eyeball the output once before committing (it should contain lesson content
 * only — no password hashes or secrets).
 */
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { Content } from "../src/models/content.model";

const LESSON_ID = "69e39d0b60d467bd515a4945";

async function main() {
  await mongoose.connect(process.env.MONGO_URI as string, {
    dbName: "HotPotato",
  });
  const doc = await Content.findById(LESSON_ID).lean();
  if (!doc) throw new Error(`Lesson ${LESSON_ID} not found`);

  const fixture = {
    ...doc,
    _id: String(doc._id),
    owner_id: "FIXTURE_OWNER", // remapped to a seeded user at seed time
    collaborators: [],
    collaborator_names: [],
    author_name: "Fixture Teacher",
  };

  const outDir = path.join(__dirname, "..", "test", "fixtures");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "lesson.json"),
    JSON.stringify(fixture, null, 2),
  );
  console.log(
    `Wrote test/fixtures/lesson.json (${String(fixture.tiptap_json).length} chars of tiptap_json)`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
