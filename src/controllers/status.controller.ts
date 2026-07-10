import { Request, Response } from "express";
import mongoose from "mongoose";
import os from "os";

// ─── Required env vars to validate ────────────────────────────────────────────
const REQUIRED_ENV_VARS = ["PORT", "MONGO_URI", "JWT_SECRET", "JWT_EXPIRES_IN"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mongoStateLabel(state: number): string {
  return (
    ["disconnected", "connected", "connecting", "disconnecting"][state] ??
    "unknown"
  );
}

function uptimeFormatted(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// ─── GET /api/status/ ─────────────────────────────────────────────────────────
export const getServerStatus = (_req: Request, res: Response): void => {
  res.status(200).json({
    status: "ok",
    message: "Server is running",
    timestamp: new Date().toISOString(),
    uptime: uptimeFormatted(process.uptime()),
    environment: process.env.NODE_ENV ?? "unknown",
    node_version: process.version,
    memory: {
      rss_mb: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
      heap_used_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
      heap_total_mb: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2),
    },
    platform: os.platform(),
    hostname: os.hostname(),
  });
};

// ─── GET /api/status/database ─────────────────────────────────────────────────
export const getDatabaseStatus = (_req: Request, res: Response): void => {
  const state = mongoose.connection.readyState;
  const label = mongoStateLabel(state);
  const isConnected = state === 1;

  res.status(isConnected ? 200 : 503).json({
    status: isConnected ? "ok" : "error",
    database: "MongoDB",
    connection: label,
    ready_state: state,
  });
};

// ─── GET /api/status/env ──────────────────────────────────────────────────────
export const getEnvStatus = (_req: Request, res: Response): void => {
  const checks = REQUIRED_ENV_VARS.map((key) => ({
    key,
    loaded: key in process.env && process.env[key] !== "",
  }));

  const allLoaded = checks.every((c) => c.loaded);

  res.status(allLoaded ? 200 : 500).json({
    status: allLoaded ? "ok" : "error",
    variables: checks,
    ...(process.env.NODE_ENV === "development" && {
      note: "Values are hidden for security. Only key presence is checked.",
    }),
  });
};

// ─── GET /api/status/all ──────────────────────────────────────────────────────
export const getAllStatus = (_req: Request, res: Response): void => {
  // Server
  const serverOk = true;

  // Database
  const dbState = mongoose.connection.readyState;
  const dbOk = dbState === 1;

  // Env
  const envChecks = REQUIRED_ENV_VARS.map((key) => ({
    key,
    loaded: key in process.env && process.env[key] !== "",
  }));
  const envOk = envChecks.every((c) => c.loaded);

  const overallOk = serverOk && dbOk && envOk;

  res.status(overallOk ? 200 : 503).json({
    status: overallOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks: {
      server: {
        status: serverOk ? "ok" : "error",
        uptime: uptimeFormatted(process.uptime()),
        environment: process.env.NODE_ENV ?? "unknown",
      },
      database: {
        status: dbOk ? "ok" : "error",
        connection: mongoStateLabel(dbState),
      },
      env: {
        status: envOk ? "ok" : "error",
        variables: envChecks,
      },
    },
  });
};
