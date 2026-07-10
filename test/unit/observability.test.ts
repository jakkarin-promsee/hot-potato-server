import { describe, it, expect, beforeEach } from "vitest";
import {
  getAiHealth,
  getErrorSummary,
  getErrorSummaryDetailed,
  recordAiFailure,
  recordAiSuccess,
  recordServerError,
  resetObservabilityForTests,
} from "../../src/services/observability.service";

describe("observability service", () => {
  beforeEach(() => resetObservabilityForTests());

  it("starts empty: ai unknown, zero errors", () => {
    expect(getAiHealth()).toEqual({
      status: "unknown",
      last_success: null,
      last_failure: null,
    });
    const summary = getErrorSummary();
    expect(summary.count_since_boot).toBe(0);
    expect(summary.last_error_at).toBeNull();
    expect(summary.recent).toEqual([]);
    expect(typeof summary.since).toBe("string");
  });

  it("records errors newest-first; public payload has no name", () => {
    recordServerError({ method: "GET", route: "/api/a", status: 500, name: "TypeError" });
    recordServerError({ method: "POST", route: "/api/b", status: 502, name: "Error" });
    const { recent, count_since_boot, last_error_at } = getErrorSummary();
    expect(count_since_boot).toBe(2);
    expect(recent[0].route).toBe("/api/b");
    expect(recent[1].route).toBe("/api/a");
    expect(last_error_at).toBe(recent[0].time);
    expect((recent[0] as Record<string, unknown>).name).toBeUndefined();
    expect((recent[0] as Record<string, unknown>).message).toBeUndefined();
    expect((recent[0] as Record<string, unknown>).stack).toBeUndefined();
  });

  it("detailed payload keeps the error name (admin view)", () => {
    recordServerError({ method: "GET", route: "/api/a", status: 500, name: "TypeError" });
    expect(getErrorSummaryDetailed().recent[0].name).toBe("TypeError");
  });

  it("strips query strings and truncates long routes", () => {
    recordServerError({
      method: "GET",
      route: "/api/content/load?id=123&token=secret",
      status: 500,
      name: "Error",
    });
    expect(getErrorSummaryDetailed().recent[0].route).toBe("/api/content/load");

    recordServerError({
      method: "GET",
      route: "/" + "x".repeat(500),
      status: 500,
      name: "Error",
    });
    expect(getErrorSummaryDetailed().recent[0].route.length).toBeLessThanOrEqual(120);
  });

  it("caps the buffer at 50 but keeps counting", () => {
    for (let i = 0; i < 60; i++) {
      recordServerError({ method: "GET", route: `/api/e${i}`, status: 500, name: "Error" });
    }
    const summary = getErrorSummary();
    expect(summary.recent.length).toBe(50);
    expect(summary.count_since_boot).toBe(60);
    expect(summary.recent[0].route).toBe("/api/e59");
  });

  it("ai health transitions unknown → ok → degraded with timestamps", () => {
    recordAiSuccess();
    let health = getAiHealth();
    expect(health.status).toBe("ok");
    expect(health.last_success).toBeTruthy();
    expect(health.last_failure).toBeNull();

    recordAiFailure();
    health = getAiHealth();
    expect(health.status).toBe("degraded");
    expect(health.last_failure).toBeTruthy();
    expect(health.last_success).toBeTruthy();
  });
});
