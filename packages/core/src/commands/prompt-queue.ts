import type { QueuedPrompt } from "../channels/types.js";

export type EnqueueResult =
  | { ok: true; position: number }
  | { ok: false; reason: "full" };

export class PromptQueue {
  private readonly items: QueuedPrompt[] = [];

  constructor(private readonly maxSize: number) {}

  get size(): number {
    return this.items.length;
  }

  enqueue(item: QueuedPrompt): EnqueueResult {
    if (this.items.length >= this.maxSize) {
      return { ok: false, reason: "full" };
    }
    this.items.push(item);
    return { ok: true, position: this.items.length };
  }

  dequeue(): QueuedPrompt | null {
    return this.items.shift() ?? null;
  }

  /**
   * Put an item back at the front (e.g. after a failed acquire).
   * Never grows past maxSize — drops the newest waiting item if needed.
   */
  enqueueFront(item: QueuedPrompt): void {
    if (this.items.length >= this.maxSize) {
      this.items.pop();
    }
    this.items.unshift(item);
  }

  clear(): void {
    this.items.length = 0;
  }
}
