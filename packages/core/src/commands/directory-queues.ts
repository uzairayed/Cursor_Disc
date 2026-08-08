import type { QueuedPrompt } from "../channels/types.js";
import { PromptQueue } from "./prompt-queue.js";

export class DirectoryQueues {
  private readonly queues = new Map<string, PromptQueue>();

  constructor(private readonly maxPerDirectory: number) {}

  getQueue(workspace: string): PromptQueue {
    let queue = this.queues.get(workspace);
    if (!queue) {
      queue = new PromptQueue(this.maxPerDirectory);
      this.queues.set(workspace, queue);
    }
    return queue;
  }

  size(workspace: string): number {
    return this.getQueue(workspace).size;
  }

  totalSize(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.size;
    }
    return total;
  }

  enqueue(item: QueuedPrompt) {
    return this.getQueue(item.workspace).enqueue(item);
  }

  dequeue(workspace: string): QueuedPrompt | null {
    return this.getQueue(workspace).dequeue();
  }

  enqueueFront(item: QueuedPrompt): void {
    this.getQueue(item.workspace).enqueueFront(item);
  }

  clear(workspace: string): number {
    const queue = this.queues.get(workspace);
    if (!queue) return 0;
    const n = queue.size;
    queue.clear();
    return n;
  }

  clearAll(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.size;
      queue.clear();
    }
    return total;
  }

  /** First non-empty queue with an idle workspace (caller verifies idle). */
  findNextIdleQueue(isWorkspaceBusy: (workspace: string) => boolean): QueuedPrompt | null {
    for (const [workspace, queue] of this.queues) {
      if (queue.size > 0 && !isWorkspaceBusy(workspace)) {
        return queue.dequeue();
      }
    }
    return null;
  }

  queueDepths(): { workspace: string; depth: number }[] {
    const out: { workspace: string; depth: number }[] = [];
    for (const [workspace, queue] of this.queues) {
      if (queue.size > 0) {
        out.push({ workspace, depth: queue.size });
      }
    }
    return out;
  }
}
