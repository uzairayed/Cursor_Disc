import { describe, expect, it } from "vitest";
import { pickFinalReply } from "./capture-reply.js";

describe("pickFinalReply", () => {
  it("returns the last non-progress reply", () => {
    expect(
      pickFinalReply(["Working…", "Still working…", "Fixed the login bug."])
    ).toBe("Fixed the login bug.");
  });

  it("falls back to the last reply when all look like progress", () => {
    expect(pickFinalReply(["Working…"])).toBe("Working…");
  });

  it("returns null for empty lists", () => {
    expect(pickFinalReply([])).toBeNull();
  });
});
