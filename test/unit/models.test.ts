import { describe, it, expect, afterEach } from "vitest";
import { getFastModel } from "../../src/services/tutor/models";
import { getFastModel as controllerFastModel } from "../../src/controllers/tutor.controller";

describe("model defaults single source", () => {
  const saved = process.env.AI_FAST_MODEL;

  afterEach(() => {
    if (saved === undefined) delete process.env.AI_FAST_MODEL;
    else process.env.AI_FAST_MODEL = saved;
  });

  it("controller and models.ts resolve the same fast model from env", () => {
    process.env.AI_FAST_MODEL = "shared-fast-model";
    expect(getFastModel()).toBe("shared-fast-model");
    expect(controllerFastModel()).toBe("shared-fast-model");
  });
});
