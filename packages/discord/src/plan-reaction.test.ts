import { describe, expect, it } from "vitest";
import { shouldApprovePlanFromReaction } from "./plan-reaction.js";

describe("shouldApprovePlanFromReaction", () => {
  it("approves when an allowlisted user reacts ✅ on the plan message", () => {
    expect(
      shouldApprovePlanFromReaction({
        emojiName: "✅",
        reactorIsBot: false,
        messageId: "plan-1",
        pendingApprovalMessageId: "plan-1",
      }),
    ).toBe(true);
  });

  it("ignores the bot's own seed reaction", () => {
    expect(
      shouldApprovePlanFromReaction({
        emojiName: "✅",
        reactorIsBot: true,
        messageId: "plan-1",
        pendingApprovalMessageId: "plan-1",
      }),
    ).toBe(false);
  });

  it("ignores other emojis and other messages", () => {
    expect(
      shouldApprovePlanFromReaction({
        emojiName: "👀",
        reactorIsBot: false,
        messageId: "plan-1",
        pendingApprovalMessageId: "plan-1",
      }),
    ).toBe(false);
    expect(
      shouldApprovePlanFromReaction({
        emojiName: "✅",
        reactorIsBot: false,
        messageId: "other",
        pendingApprovalMessageId: "plan-1",
      }),
    ).toBe(false);
  });
});
