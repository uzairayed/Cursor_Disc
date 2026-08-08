import { describe, expect, it } from "vitest";
import { modelForExecutionMode } from "./model-for-mode.js";

const cfg = {
  cursorPlanModel: "gpt-5.2",
  cursorAgentModel: "cursor-grok-4.5-high",
  cursorAskModel: null as string | null,
};

describe("modelForExecutionMode", () => {
  it("uses plan model for plan mode", () => {
    expect(modelForExecutionMode(cfg, "plan")).toBe("gpt-5.2");
  });

  it("uses agent model for agent mode", () => {
    expect(modelForExecutionMode(cfg, "agent")).toBe("cursor-grok-4.5-high");
  });

  it("falls back ask → agent when ask model unset", () => {
    expect(modelForExecutionMode(cfg, "ask")).toBe("cursor-grok-4.5-high");
  });

  it("returns undefined when unset (Cursor Auto)", () => {
    expect(
      modelForExecutionMode(
        { cursorPlanModel: null, cursorAgentModel: null, cursorAskModel: null },
        "agent"
      )
    ).toBeUndefined();
  });
});
