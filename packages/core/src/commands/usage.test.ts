import { describe, expect, it } from "vitest";
import { CONTEXT_WARN_INPUT_TOKENS, formatUsageFooter, shouldWarnContext } from "./usage.js";

describe("usage helpers", () => {
  it("formats a short token footer", () => {
    expect(
      formatUsageFooter({
        inputTokens: 17472,
        outputTokens: 12,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toMatch(/~17k|17,?472/i);
  });

  it("warns when input tokens are high", () => {
    expect(shouldWarnContext({ inputTokens: CONTEXT_WARN_INPUT_TOKENS })).toBe(true);
    expect(shouldWarnContext({ inputTokens: 1000 })).toBe(false);
  });

  it("includes a new-chat hint when warning", () => {
    const footer = formatUsageFooter(
      {
        inputTokens: CONTEXT_WARN_INPUT_TOKENS,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      { warn: true },
    );
    expect(footer.toLowerCase()).toMatch(/new chat|start fresh/);
  });
});
