import dotenv from "dotenv";
dotenv.config();

import connectDB from "./config/db";
import app from "./app";

connectDB().catch((err) => {
  console.error("DB connection failed:", err);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
