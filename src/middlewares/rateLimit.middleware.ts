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

// Bot guard for credential endpoints. Generous on purpose: a whole classroom
// can share one school NAT IP, so the ceiling must comfortably exceed
// "40 students all logging in during first period".
export function createAuthRateLimiter() {
  const perWindow = Number(process.env.AUTH_RATELIMIT_PER_10MIN) || 100;
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: perWindow,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many attempts, please try again later" },
  });
}
