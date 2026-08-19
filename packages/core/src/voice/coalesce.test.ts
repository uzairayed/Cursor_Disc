import { describe, expect, it } from "vitest";
import { adaptiveCoalesceMs } from "./session.js";

describe("adaptiveCoalesceMs", () => {
  it("is immediate for date and commands", () => {
    expect(adaptiveCoalesceMs("what's the date today")).toBe(0);
    expect(adaptiveCoalesceMs("status")).toBe(0);
  });

  it("waits longer for thin or truncated agent fragments", () => {
    expect(adaptiveCoalesceMs("you")).toBeGreaterThan(adaptiveCoalesceMs("fix the login bug"));
    expect(adaptiveCoalesceMs("latest news for")).toBeGreaterThan(250);
  });

  it("uses a short window for complete agent asks", () => {
    expect(adaptiveCoalesceMs("fix the login bug in cliproom")).toBe(250);
  });
});
