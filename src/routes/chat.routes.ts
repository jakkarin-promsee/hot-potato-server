import { Router } from "express";
import {
  askChat,
  askFeedback,
  askWriteEvaluation,
} from "../controllers/chat.controller";
import { clearMemory, getMemory } from "../controllers/memory.controller";
import { tutorChat } from "../controllers/tutor.controller";
import { optionalAuth, protect } from "../middlewares/auth.middleware";
import { createChatRateLimiter } from "../middlewares/rateLimit.middleware";

const router = Router();

const chatGuards = [optionalAuth, ...createChatRateLimiter()];

// POST /api/chat/ask
router.post("/ask", ...chatGuards, askChat);
router.post("/feedback", ...chatGuards, askFeedback);
router.post("/write-evaluate", ...chatGuards, askWriteEvaluation);
router.post("/tutor", ...chatGuards, tutorChat);

router.get("/memory", protect, getMemory);
router.delete("/memory", protect, clearMemory);

export default router;
