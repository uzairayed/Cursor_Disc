import { describe, expect, it, vi } from "vitest";
import { formatReplyContext, mergeReplyIntoPrompt, resolveReplyContext } from "./reply-context.js";

describe("formatReplyContext", () => {
  it("formats author + body", () => {
    const out = formatReplyContext({
      content: "Deploy failed on staging",
      author: { username: "ali" },
      attachments: { size: 0, values: () => [] },
    });
    expect(out).toMatch(/ali/);
    expect(out).toContain("Deploy failed on staging");
  });

  it("includes attachment names when there is no text", () => {
    const out = formatReplyContext({
      content: "",
      author: { username: "ali" },
      attachments: {
        size: 1,
        values: () => [{ name: "shot.png", url: "https://cdn/shot.png" }],
      },
    });
    expect(out).toMatch(/shot\.png/);
  });
});

describe("resolveReplyContext", () => {
  it("returns null when not a reply", async () => {
    expect(await resolveReplyContext({})).toBeNull();
  });

  it("uses cached referencedMessage when present", async () => {
    const out = await resolveReplyContext({
      reference: { messageId: "m1" },
      referencedMessage: {
        content: "hello world",
        author: { username: "bob" },
      },
    });
    expect(out).toContain("hello world");
  });

  it("fetches the reference when not cached", async () => {
    const fetchReference = vi.fn(async () => ({
      content: "from fetch",
      author: { username: "cara" },
    }));
    const out = await resolveReplyContext({
      reference: { messageId: "m2" },
      referencedMessage: null,
      fetchReference,
    });
    expect(fetchReference).toHaveBeenCalledOnce();
    expect(out).toContain("from fetch");
  });
});

describe("mergeReplyIntoPrompt", () => {
  it("prepends reply context to the user prompt", () => {
    const merged = mergeReplyIntoPrompt(
      "summarize this",
      "(Replying to a message from ali:)\n```\nDeploy failed\n```",
    );
    expect(merged).toMatch(/Deploy failed/);
    expect(merged).toMatch(/summarize this/);
  });

  it("asks to read the quote when the user only tagged with no extra text", () => {
    const merged = mergeReplyIntoPrompt(
      null,
      "(Replying to a message from ali:)\n```\nDeploy failed\n```",
    );
    expect(merged).toMatch(/Deploy failed/);
    expect(merged).toMatch(/read the quoted message/i);
  });
});
