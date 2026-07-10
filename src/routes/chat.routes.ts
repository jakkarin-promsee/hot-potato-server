import { Router } from "express";
import {
  askChat,
  askFeedback,
  askWriteEvaluation,
} from "../controllers/chat.controller";
import { optionalAuth } from "../middlewares/auth.middleware";
import { createChatRateLimiter } from "../middlewares/rateLimit.middleware";

const router = Router();

const chatGuards = [optionalAuth, ...createChatRateLimiter()];

// POST /api/chat/ask
router.post("/ask", ...chatGuards, askChat);
router.post("/feedback", ...chatGuards, askFeedback);
router.post("/write-evaluate", ...chatGuards, askWriteEvaluation);

export default router;
