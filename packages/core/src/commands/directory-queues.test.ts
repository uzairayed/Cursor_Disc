import { describe, expect, it, vi } from "vitest";
import type { DeliveryContext } from "../channels/types.js";
import { DirectoryQueues } from "./directory-queues.js";

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

function item(prompt: string, workspace: string, projectKey = "crm") {
  return {
    prompt,
    delivery: delivery(workspace),
    projectKey,
    workspace,
  };
}

describe("DirectoryQueues", () => {
  it("keeps separate FIFO queues per workspace", () => {
    const q = new DirectoryQueues(3);
    q.enqueue(item("a1", "/a"));
    q.enqueue(item("b1", "/b"));
    q.enqueue(item("a2", "/a"));

    expect(q.size("/a")).toBe(2);
    expect(q.size("/b")).toBe(1);
    expect(q.dequeue("/a")?.prompt).toBe("a1");
    expect(q.dequeue("/a")?.prompt).toBe("a2");
    expect(q.dequeue("/b")?.prompt).toBe("b1");
  });

  it("clear only affects one workspace", () => {
    const q = new DirectoryQueues(5);
    q.enqueue(item("a", "/a"));
    q.enqueue(item("b", "/b"));
    expect(q.clear("/a")).toBe(1);
    expect(q.size("/a")).toBe(0);
    expect(q.size("/b")).toBe(1);
  });

  it("findNextIdleQueue skips busy workspaces", () => {
    const q = new DirectoryQueues(5);
    q.enqueue(item("a", "/a"));
    q.enqueue(item("b", "/b"));

    const next = q.findNextIdleQueue((ws) => ws === "/a");
    expect(next?.workspace).toBe("/b");
    expect(q.size("/b")).toBe(0);
  });
});
