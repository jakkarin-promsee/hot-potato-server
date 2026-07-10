import { Router } from "express";
import { clearMemory, getMemory } from "../controllers/memory.controller";
import { tutorChat } from "../controllers/tutor.controller";
import { optionalAuth, protect } from "../middlewares/auth.middleware";
import { createChatRateLimiter } from "../middlewares/rateLimit.middleware";

const router = Router();

const chatGuards = [optionalAuth, ...createChatRateLimiter()];

// POST /api/chat/tutor — the unified tutor agent (the only AI endpoint)
router.post("/tutor", ...chatGuards, tutorChat);

router.get("/memory", protect, getMemory);
router.delete("/memory", protect, clearMemory);

export default router;
