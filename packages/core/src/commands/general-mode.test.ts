import { describe, expect, it } from "vitest";
import { generalExecutionMode } from "./general-mode.js";

describe("generalExecutionMode", () => {
  it("uses agent when live search is needed", () => {
    expect(generalExecutionMode("news for karachi")).toBe("agent");
    expect(generalExecutionMode("how's the traffic")).toBe("agent");
    expect(generalExecutionMode("latest weather")).toBe("agent");
  });

  it("keeps ask for casual chat", () => {
    expect(generalExecutionMode("how are you")).toBe("ask");
    expect(generalExecutionMode("thanks bro")).toBe("ask");
    expect(generalExecutionMode("what does inflation mean")).toBe("ask");
  });
});
