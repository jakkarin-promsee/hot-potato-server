import dotenv from "dotenv";
dotenv.config();

if (!process.env.CORS_ORIGINS) {
  console.warn(
    "⚠️ CORS_ORIGINS not set — CORS is wide open. Set it in production (comma-separated origins).",
  );
}

import connectDB from "./config/db";
import app from "./app";

connectDB().catch((err) => {
  console.error("DB connection failed:", err);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
