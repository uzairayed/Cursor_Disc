import { describe, expect, it, vi } from "vitest";
import type { DeliveryContext } from "../channels/types.js";
import { PromptQueue } from "./prompt-queue.js";

function delivery(tag: string): DeliveryContext {
  return {
    platform: "discord",
    projectKey: "crm",
    reply: vi.fn(async () => undefined),
    formatOutput: (t) => t,
    maxChars: 2000,
    sourceId: tag,
  };
}

describe("PromptQueue (delivery-aware)", () => {
  it("enqueues up to the cap and reports position", () => {
    const q = new PromptQueue(3);
    const d = delivery("a");
    expect(q.enqueue({ prompt: "a", delivery: d, projectKey: "crm", workspace: "/crm" })).toEqual({
      ok: true,
      position: 1,
    });
    expect(q.enqueue({ prompt: "b", delivery: d, projectKey: "crm", workspace: "/crm" })).toEqual({
      ok: true,
      position: 2,
    });
    expect(q.enqueue({ prompt: "c", delivery: d, projectKey: "crm", workspace: "/crm" })).toEqual({
      ok: true,
      position: 3,
    });
    expect(q.enqueue({ prompt: "d", delivery: d, projectKey: "crm", workspace: "/crm" })).toEqual({
      ok: false,
      reason: "full",
    });
    expect(q.size).toBe(3);
  });

  it("drains FIFO and preserves each item's delivery context", () => {
    const q = new PromptQueue(5);
    const aCtx = delivery("thread-a");
    const bCtx = delivery("thread-b");
    q.enqueue({ prompt: "first", delivery: aCtx, projectKey: "crm", workspace: "/crm" });
    q.enqueue({ prompt: "second", delivery: bCtx, projectKey: "fleet", workspace: "/fleet" });

    const a = q.dequeue();
    const b = q.dequeue();
    expect(a?.prompt).toBe("first");
    expect(a?.delivery.platform).toBe("discord");
    expect(a?.delivery.sourceId).toBe("thread-a");
    expect(b?.prompt).toBe("second");
    expect(b?.delivery.platform).toBe("discord");
    expect(b?.delivery.sourceId).toBe("thread-b");
    expect(q.dequeue()).toBeNull();
  });

  it("clear empties the queue", () => {
    const q = new PromptQueue(5);
    q.enqueue({ prompt: "a", delivery: delivery("x"), projectKey: "crm", workspace: "/crm" });
    q.clear();
    expect(q.size).toBe(0);
    expect(q.dequeue()).toBeNull();
  });

  it("enqueueFront never grows past maxSize", () => {
    const q = new PromptQueue(2);
    const d = delivery("x");
    const item = { prompt: "a", delivery: d, projectKey: "crm", workspace: "/crm" };
    expect(q.enqueue(item).ok).toBe(true);
    expect(q.enqueue({ ...item, prompt: "b" }).ok).toBe(true);
    q.enqueueFront({ ...item, prompt: "front" });
    expect(q.size).toBe(2);
    expect(q.dequeue()?.prompt).toBe("front");
  });
});
