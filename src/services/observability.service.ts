// In-memory observability signals for the public /status page (Tier 1.A).
//
// Intentionally in-memory: Render's free tier restarts wipe it, which is
// acceptable — the Status page labels the data "since last restart".
// PRIVACY RULE: never store request bodies, student messages, or error
// messages (err.message can echo user input). Only names, routes, status
// codes, and timestamps — and even names stay off the public payload.

const MAX_RECENT_ERRORS = 50;
const MAX_ROUTE_LENGTH = 120;
const MAX_NAME_LENGTH = 80;

export interface RecordedError {
  time: string; // ISO timestamp
  method: string; // "GET" | "POST" | ...
  route: string; // path only — query string stripped
  status: number; // HTTP status the client received (or semantic outcome for SSE)
  name: string; // err.name only — NEVER err.message
}

export type PublicRecordedError = Omit<RecordedError, "name">;

export type AiStatus = "ok" | "degraded" | "unknown";

export interface AiHealth {
  status: AiStatus;
  last_success: string | null;
  last_failure: string | null;
}

const bootTime = new Date().toISOString();

let recentErrors: RecordedError[] = [];
let errorCountSinceBoot = 0;

let aiStatus: AiStatus = "unknown";
let aiLastSuccess: string | null = null;
let aiLastFailure: string | null = null;

export function recordServerError(entry: {
  method: string;
  route: string;
  status: number;
  name: string;
}): void {
  const route = (entry.route || "").split("?")[0].slice(0, MAX_ROUTE_LENGTH);
  recentErrors.unshift({
    time: new Date().toISOString(),
    method: entry.method || "UNKNOWN",
    route,
    status: entry.status,
    name: (entry.name || "Error").slice(0, MAX_NAME_LENGTH),
  });
  if (recentErrors.length > MAX_RECENT_ERRORS) {
    recentErrors.length = MAX_RECENT_ERRORS;
  }
  errorCountSinceBoot += 1;
}

export function recordAiSuccess(): void {
  aiStatus = "ok";
  aiLastSuccess = new Date().toISOString();
}

export function recordAiFailure(): void {
  aiStatus = "degraded";
  aiLastFailure = new Date().toISOString();
}

export function getAiHealth(): AiHealth {
  return {
    status: aiStatus,
    last_success: aiLastSuccess,
    last_failure: aiLastFailure,
  };
}

// Public payload — error names stripped (a library name can hint at internals).
export function getErrorSummary(): {
  count_since_boot: number;
  last_error_at: string | null;
  since: string;
  recent: PublicRecordedError[];
} {
  return {
    count_since_boot: errorCountSinceBoot,
    last_error_at: recentErrors[0]?.time ?? null,
    since: bootTime,
    recent: recentErrors.map(({ name: _name, ...pub }) => pub),
  };
}

// Admin payload — includes err.name (still never messages or stacks).
export function getErrorSummaryDetailed(): {
  count_since_boot: number;
  last_error_at: string | null;
  since: string;
  recent: RecordedError[];
} {
  return {
    count_since_boot: errorCountSinceBoot,
    last_error_at: recentErrors[0]?.time ?? null,
    since: bootTime,
    recent: [...recentErrors],
  };
}

// Test-only: module-level state must be resettable between test cases.
export function resetObservabilityForTests(): void {
  recentErrors = [];
  errorCountSinceBoot = 0;
  aiStatus = "unknown";
  aiLastSuccess = null;
  aiLastFailure = null;
}
