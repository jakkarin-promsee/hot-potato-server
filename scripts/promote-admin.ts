/**
 * Promote an existing user to admin (or another role).
 *
 * Usage: npx ts-node scripts/promote-admin.ts <email> [role]
 *   role defaults to "admin"; must be admin|creator|learner
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { User } from "../src/models/user.model";

const VALID_ROLES = ["admin", "creator", "learner"] as const;

async function main() {
  const email = process.argv[2];
  const role = (process.argv[3] ?? "admin").toLowerCase();

  if (!email) {
    console.error("Usage: npx ts-node scripts/promote-admin.ts <email> [role]");
    process.exit(1);
  }

  if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
    console.error(
      `Invalid role "${role}". Must be one of: ${VALID_ROLES.join("|")}`,
    );
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI as string);
  const result = await User.updateOne(
    { email: email.toLowerCase() },
    { $set: { role } },
  );
  console.log(`matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
