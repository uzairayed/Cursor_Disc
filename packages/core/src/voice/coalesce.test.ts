import { describe, expect, it } from "vitest";
import { adaptiveCoalesceMs } from "./session.js";

describe("adaptiveCoalesceMs", () => {
  it("is immediate for date, mail, and commands", () => {
    expect(adaptiveCoalesceMs("what's the date today")).toBe(0);
    expect(adaptiveCoalesceMs("check my email")).toBe(0);
    expect(adaptiveCoalesceMs("status")).toBe(0);
  });

  it("waits longer for thin or truncated agent fragments", () => {
    expect(adaptiveCoalesceMs("you")).toBeGreaterThan(adaptiveCoalesceMs("fix the login bug"));
    expect(adaptiveCoalesceMs("latest news for")).toBeGreaterThan(400);
  });

  it("uses a short window for complete agent asks", () => {
    expect(adaptiveCoalesceMs("fix the login bug in cliproom")).toBe(400);
  });
});
