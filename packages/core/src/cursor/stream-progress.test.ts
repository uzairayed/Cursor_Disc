import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLiveProgressReporter,
  formatToolCallProgress,
  progressEventFromStreamLine,
  summarizeShellCommand,
} from "../commands/progress.js";

describe("summarizeShellCommand", () => {
  it("shortens absolute paths to basenames", () => {
    expect(
      summarizeShellCommand(
        "node /Users/apple/.claude/skills/impeccable/scripts/serve-preview.js --port 57381"
      )
    ).toMatch(/^node serve-preview\.js/);
  });

  it("keeps short npm commands readable", () => {
    expect(summarizeShellCommand("npm test -- --run src/foo.test.ts")).toMatch(
      /^npm test/
    );
  });
});

describe("formatToolCallProgress", () => {
  it("formats a read tool call", () => {
    expect(
      formatToolCallProgress({
        readToolCall: { args: { path: "/tmp/proj/src/App.tsx" } },
      })
    ).toBe("Read · `App.tsx`");
  });

  it("formats a shell command briefly", () => {
    expect(
      formatToolCallProgress({
        shellToolCall: {
          args: {
            command:
              "node /Users/apple/.claude/skills/impeccable/scripts/concept.js",
          },
        },
      })
    ).toBe("Run · `node concept.js`");
  });

  it("formats edit/write by path", () => {
    expect(
      formatToolCallProgress({
        editToolCall: { args: { path: "packages/ui/Button.tsx" } },
      })
    ).toBe("Edit · `Button.tsx`");
  });

  it("humanizes todo tool names", () => {
    expect(
      formatToolCallProgress({
        updateTodosToolCall: { args: {} },
      })
    ).toBe("Todos · updating");
  });
});

describe("progressEventFromStreamLine", () => {
  it("returns a tool progress line for tool_call started", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "started",
      tool_call: {
        readToolCall: { args: { path: "/repo/hi.js" } },
      },
    });
    expect(progressEventFromStreamLine(line)).toEqual({
      kind: "tool",
      text: "Read · `hi.js`",
    });
  });

  it("returns a short assistant note when useful", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "I'll polish the card glare next." }],
      },
    });
    expect(progressEventFromStreamLine(line)).toEqual({
      kind: "assistant",
      text: "I'll polish the card glare next.",
    });
  });

  it("skips long markdown assistant dumps", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "You picked Cabinet.\n\n### Shape brief\n**Job** riders...",
          },
        ],
      },
    });
    expect(progressEventFromStreamLine(line)).toBeNull();
  });

  it("ignores thinking deltas and completed tools", () => {
    expect(
      progressEventFromStreamLine(
        JSON.stringify({ type: "thinking", subtype: "delta", text: "hmm" })
      )
    ).toBeNull();
    expect(
      progressEventFromStreamLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          tool_call: { readToolCall: { args: { path: "x" } } },
        })
      )
    ).toBeNull();
  });
});

describe("createLiveProgressReporter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends immediately then throttles duplicates within the interval", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const reporter = createLiveProgressReporter({
      minIntervalMs: 10_000,
      onSend: async (msg) => {
        sent.push(msg);
      },
    });

    reporter.report("Read · `a.ts`");
    await Promise.resolve();
    expect(sent).toEqual(["Read · `a.ts`"]);

    reporter.report("Edit · `b.ts`");
    reporter.report("Edit · `c.ts`");
    await Promise.resolve();
    expect(sent).toEqual(["Read · `a.ts`"]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toEqual(["Read · `a.ts`", "Edit · `c.ts`"]);
    reporter.stop();
  });
});
