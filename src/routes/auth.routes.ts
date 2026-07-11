import { Router } from "express";
import {
  register,
  login,
  googleLogin,
  recheckToken,
  changePassword,
} from "../controllers/auth.controller";
import { protect } from "../middlewares/auth.middleware";
import { createAuthRateLimiter } from "../middlewares/rateLimit.middleware";

const router = Router();
const authLimiter = createAuthRateLimiter();

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/google", authLimiter, googleLogin);
router.get("/recheck", protect, recheckToken);
router.put("/change-password", protect, changePassword);

export default router;
