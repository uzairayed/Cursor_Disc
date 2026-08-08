import { describe, expect, it } from "vitest";
import { extractCursorText } from "./extract-text.js";

describe("extractCursorText", () => {
  it("extracts result text, session id, and usage from stream-json lines", () => {
    const stdout = [
      JSON.stringify({ type: "system", session_id: "sess-1" }),
      JSON.stringify({
        type: "result",
        result: "All done.",
        session_id: "sess-1",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
    ].join("\n");

    expect(extractCursorText(stdout)).toEqual({
      text: "All done.",
      sessionId: "sess-1",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });
  });

  it("prefers the longest assistant message when the result is a short stub", () => {
    const longAssistant =
      "Here is the full analysis of the login bug. ".repeat(10).trim();
    const stdout = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: longAssistant }],
        },
      }),
      JSON.stringify({
        type: "result",
        result: "I'll review the login flow and then draft a fix.",
        session_id: "s2",
      }),
    ].join("\n");

    const extracted = extractCursorText(stdout);
    expect(extracted.sessionId).toBe("s2");
    expect(extracted.text).toBe(longAssistant);
  });

  it("ignores assistant events that are model_call stubs", () => {
    const stdout = [
      JSON.stringify({
        type: "assistant",
        model_call_id: "mc-1",
        message: {
          content: [{ type: "text", text: "internal thinking noise" }],
        },
      }),
      JSON.stringify({
        type: "result",
        result: "Final answer for the user.",
        session_id: "s3",
      }),
    ].join("\n");

    expect(extractCursorText(stdout).text).toBe("Final answer for the user.");
  });

  it("falls back to plain stdout when there is no JSON", () => {
    expect(extractCursorText("plain agent output")).toEqual({
      text: "plain agent output",
      sessionId: null,
      usage: null,
    });
  });

  it("parses a single-line Cursor JSON blob", () => {
    const stdout = JSON.stringify({
      type: "result",
      result: "ok from json mode",
      session_id: "single",
    });
    expect(extractCursorText(stdout)).toEqual({
      text: "ok from json mode",
      sessionId: "single",
      usage: null,
    });
  });

  it("skips non-JSON noise between stream events", () => {
    const stdout = [
      "noise",
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello from assistant" }] },
      }),
      "more noise",
    ].join("\n");

    expect(extractCursorText(stdout).text).toBe("Hello from assistant");
  });
});
