import { Router } from "express";
import {
  register,
  login,
  recheckToken,
  changePassword,
} from "../controllers/auth.controller";
import { protect } from "../middlewares/auth.middleware";
import { createAuthRateLimiter } from "../middlewares/rateLimit.middleware";

const router = Router();
const authLimiter = createAuthRateLimiter();

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.get("/recheck", protect, recheckToken);
router.put("/change-password", protect, changePassword);

export default router;
