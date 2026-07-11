import { Router } from "express";
import { creatorAssist } from "../controllers/creator.controller";
import { protect } from "../middlewares/auth.middleware";
import { createChatRateLimiter } from "../middlewares/rateLimit.middleware";

const router = Router();

// POST /api/creator/assist — teacher AI copilot (Tier 3.5). Teacher-only by
// nature: protect + owner/collaborator check in the controller. The factory
// call gives creator routes their own limiter buckets, separate from student
// chat (intentional — teacher AI usage never eats the student budget).
router.post("/assist", protect, ...createChatRateLimiter(), creatorAssist);

export default router;
