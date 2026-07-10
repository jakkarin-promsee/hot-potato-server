import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { AuthRequest } from "../types";

// Bot guard ONLY (Golden Rule 1): limits are generous enough that no human
// student ever hits them. Tune via env, never add per-student quotas.
export function createChatRateLimiter() {
  const per10Min = Number(process.env.AI_RATELIMIT_PER_10MIN) || 60;
  const perDay = Number(process.env.AI_RATELIMIT_PER_DAY) || 1000;

  const keyGenerator = (req: AuthRequest) =>
    req.user?._id?.toString() ?? ipKeyGenerator(req.ip ?? "");

  const shortWindow = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: per10Min,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests" },
  });
  const dayWindow = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    limit: perDay,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests" },
  });
  return [shortWindow, dayWindow];
}
