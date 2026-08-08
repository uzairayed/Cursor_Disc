import { describe, expect, it } from "vitest";
import { shouldResumeCursorChat } from "./resume-policy.js";

describe("shouldResumeCursorChat", () => {
  it("does not resume general surface (voice / #general / DMs)", () => {
    expect(
      shouldResumeCursorChat({ surface: "general", projectKey: "general" })
    ).toBe(false);
  });

  it("does not resume when project is general even if surface is missing", () => {
    expect(shouldResumeCursorChat({ projectKey: "general" })).toBe(false);
  });

  it("resumes project threads", () => {
    expect(
      shouldResumeCursorChat({ surface: "project", projectKey: "tagiser-beta" })
    ).toBe(true);
  });
});
