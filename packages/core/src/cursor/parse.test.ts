import { describe, expect, it } from "vitest";
import { parseCursorJson } from "./runner.js";

describe("parseCursorJson", () => {
  it("extracts result text and session_id from Cursor JSON output", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "ok",
      session_id: "b4a27fdc-665e-492e-8f30-f4a6c607ed10",
    });
    expect(parseCursorJson(stdout)).toEqual(
      expect.objectContaining({
        result: "ok",
        session_id: "b4a27fdc-665e-492e-8f30-f4a6c607ed10",
      })
    );
  });

  it("returns null for non-JSON stdout", () => {
    expect(parseCursorJson("plain text")).toBeNull();
  });

  it("extracts usage token counts from the result event", () => {
    const stdout = JSON.stringify({
      type: "result",
      result: "done",
      session_id: "abc",
      usage: {
        inputTokens: 17472,
        outputTokens: 12,
        cacheReadTokens: 896,
        cacheWriteTokens: 0,
      },
    });
    expect(parseCursorJson(stdout)?.usage).toEqual({
      inputTokens: 17472,
      outputTokens: 12,
      cacheReadTokens: 896,
      cacheWriteTokens: 0,
    });
  });
});
