import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import userRoutes from "./routes/user.routes";
import { errorHandler } from "./middlewares/error.middleware";
import statusRoutes from "./routes/status.routes";
import authRoutes from "./routes/auth.routes";
import contentRoutes from "./routes/content.routes";
import answerRoutes from "./routes/answer.routes";
import imageRoutes from "./routes/image.routes";
import categoryRoutes from "./routes/category.routes";
import historyRoutes from "./routes/history.routes";
import chatRoutes from "./routes/chat.routes";

// Harmless at import time; several module-load constants (e.g. in the chat
// controller) read env, so keep dotenv here. DB connection + app.listen live
// in index.ts so that tests can `import app` without a real DB or open port.
dotenv.config();

const app = express();

// Render sits behind a proxy — trust the first hop so rate-limit keys use real client IPs.
app.set("trust proxy", 1);

// Middleware
app.use(cors());
app.use(express.json());

// Status
app.get("/", (req, res) => {
  res.json({
    res: "Hot Potato said Hello World (//O-O//)\n You can use this api via .../api/xxx",
  });
});

app.use("/api/status", statusRoutes);

app.use("/api/auth", authRoutes);

app.use("/api/users", userRoutes);

app.use("/api/categories", categoryRoutes);

app.use("/api/images", imageRoutes);

app.use("/api/content", contentRoutes);

app.use("/api/history", historyRoutes);

app.use("/api/content-answer", answerRoutes);

app.use("/api/chat", chatRoutes);

// Error Handler (must be last)
app.use(errorHandler);

export default app;
