import { Router } from "express";
import {
  getAllStatus,
  getDatabaseStatus,
  getEnvStatus,
  getServerStatus,
} from "../controllers/status.controller";
import { protect, restrictTo } from "../middlewares/auth.middleware";

const router = Router();

// GET /api/status/          → server uptime, memory, platform info (admin only)
router.get("/", protect, restrictTo("admin"), getServerStatus);

// GET /api/status/database  → MongoDB connection state
router.get("/database", getDatabaseStatus);

// GET /api/status/env       → required env var presence check
router.get("/env", getEnvStatus);

// GET /api/status/all       → aggregated check for all systems
router.get("/all", getAllStatus);

export default router;
