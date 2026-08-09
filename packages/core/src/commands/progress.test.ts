import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliveryContext } from "../channels/types.js";
import {
  createProgressBoard,
  createProgressHeartbeat,
  formatElapsed,
  formatLiveStepMessage,
  formatProgressBoard,
  formatProgressMessage,
} from "./progress.js";

describe("formatElapsed", () => {
  it("formats seconds and minutes", () => {
    expect(formatElapsed(45)).toBe("45s");
    expect(formatElapsed(90)).toBe("1m 30s");
    expect(formatElapsed(125)).toBe("2m 5s");
  });
});

describe("formatProgressMessage", () => {
  it("tells the user work is still going and how to cancel", () => {
    const msg = formatProgressMessage(90, "tagiser");
    expect(msg).toMatch(/still working/i);
    expect(msg).toMatch(/\*\*TAGISER\*\*/);
    expect(msg).toMatch(/1m 30s/);
    expect(msg).toMatch(/stop/i);
  });

  it("includes the last live step when provided", () => {
    const msg = formatProgressMessage(90, "tagiser", "Read · `App.tsx`");
    expect(msg).toMatch(/Last: Read · `App\.tsx`/);
  });
});

describe("formatLiveStepMessage", () => {
  it("formats tool steps with a compact prefix", () => {
    expect(formatLiveStepMessage("Edit · `x.ts`")).toBe("▸ Edit · `x.ts`");
  });

  it("formats assistant notes as chat-style lines", () => {
    expect(formatLiveStepMessage("Checking the builder next.")).toBe(
      "💬 Checking the builder next.",
    );
  });
});

describe("formatProgressBoard", () => {
  it("stacks steps under a heartbeat header", () => {
    const body = formatProgressBoard({
      projectKey: "crm",
      elapsedSec: 90,
      steps: ["▸ Read · `a.ts`", "▸ Edit · `b.ts`"],
    });
    expect(body).toMatch(/\*\*CRM\*\*/);
    expect(body).toMatch(/1m 30s/);
    expect(body).toContain("▸ Read · `a.ts`");
    expect(body).toContain("▸ Edit · `b.ts`");
  });

  it("keeps the full step list when under maxChars", () => {
    const steps = Array.from({ length: 20 }, (_, i) => `▸ step ${i}`);
    const body = formatProgressBoard({
      projectKey: "crm",
      elapsedSec: 10,
      steps,
      maxChars: 1900,
    });
    expect(body).toContain("step 0");
    expect(body).toContain("step 19");
  });
});

describe("createProgressBoard", () => {
  it("sends once then edits the same message as steps stack", async () => {
    const replies: string[] = [];
    const edits: { id: string; text: string }[] = [];
    const delivery: DeliveryContext = {
      platform: "discord",
      projectKey: "crm",
      maxChars: 2000,
      formatOutput: (t) => t,
      reply: async (text) => {
        replies.push(text);
        return { messageId: "board-1" };
      },
      edit: async (messageId, text) => {
        edits.push({ id: messageId, text });
      },
    };

    const board = createProgressBoard(delivery, { projectKey: "crm" });
    await board.tick(45);
    await board.addStep("▸ Read · `a.ts`");
    await board.addStep("▸ Edit · `b.ts`");
    await board.tick(90);

    expect(replies).toHaveLength(1);
    expect(edits.length).toBeGreaterThanOrEqual(2);
    expect(edits.every((e) => e.id === "board-1")).toBe(true);
    expect(edits.at(-1)?.text).toContain("▸ Read · `a.ts`");
    expect(edits.at(-1)?.text).toContain("▸ Edit · `b.ts`");
    expect(edits.at(-1)?.text).toMatch(/1m 30s/);
  });

  it("starts a new message when the current one is full (keeps full log)", async () => {
    let msgSeq = 0;
    const replies: string[] = [];
    const edits: { id: string; text: string }[] = [];
    const delivery: DeliveryContext = {
      platform: "discord",
      projectKey: "crm",
      maxChars: 2000,
      formatOutput: (t) => t,
      reply: async (text) => {
        replies.push(text);
        msgSeq += 1;
        return { messageId: `board-${msgSeq}` };
      },
      edit: async (messageId, text) => {
        edits.push({ id: messageId, text });
      },
    };

    const board = createProgressBoard(delivery, { projectKey: "crm", maxChars: 120 });
    await board.addStep(`▸ first ${"a".repeat(40)}`);
    await board.addStep(`▸ second ${"b".repeat(40)}`);
    // Overflows the small page → new message for the next step
    await board.addStep(`▸ third ${"c".repeat(40)}`);

    expect(replies.length).toBeGreaterThanOrEqual(2);
    const allText = [...replies, ...edits.map((e) => e.text)].join("\n");
    expect(allText).toContain("first");
    expect(allText).toContain("second");
    expect(allText).toContain("third");
  });
});

describe("createProgressHeartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onTick on each interval until stopped", () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const hb = createProgressHeartbeat({
      intervalMs: 1000,
      onTick: (elapsed) => {
        ticks.push(elapsed);
      },
    });

    vi.advanceTimersByTime(3000);
    hb.stop();
    vi.advanceTimersByTime(2000);

    expect(ticks.length).toBe(3);
  });

  it("uses a progressive interval schedule", () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const hb = createProgressHeartbeat({
      intervalsMs: [1000, 2000, 5000],
      onTick: (elapsed) => {
        ticks.push(elapsed);
      },
    });

    vi.advanceTimersByTime(1000); // first tick at 1s
    expect(ticks.length).toBe(1);
    vi.advanceTimersByTime(2000); // second at +2s
    expect(ticks.length).toBe(2);
    vi.advanceTimersByTime(5000); // third at +5s
    expect(ticks.length).toBe(3);
    vi.advanceTimersByTime(5000); // repeats last interval
    expect(ticks.length).toBe(4);
    hb.stop();
  });
});
