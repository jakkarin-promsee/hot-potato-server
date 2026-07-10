import { Router } from "express";
import {
  askChat,
  askFeedback,
  askWriteEvaluation,
} from "../controllers/chat.controller";
import { tutorChat } from "../controllers/tutor.controller";
import { optionalAuth } from "../middlewares/auth.middleware";
import { createChatRateLimiter } from "../middlewares/rateLimit.middleware";

const router = Router();

const chatGuards = [optionalAuth, ...createChatRateLimiter()];

// POST /api/chat/ask
router.post("/ask", ...chatGuards, askChat);
router.post("/feedback", ...chatGuards, askFeedback);
router.post("/write-evaluate", ...chatGuards, askWriteEvaluation);
router.post("/tutor", ...chatGuards, tutorChat);

export default router;
