import { CursorBusyError, CursorRunner, type CursorRunOptions, type CursorRunResult } from "./runner.js";

export interface BusyRun {
  workspace: string;
  projectKey: string;
}

export class CursorRunnerPool {
  private readonly runners = new Map<string, CursorRunner>();
  private readonly active = new Map<string, BusyRun>();

  constructor(private readonly maxConcurrent: number) {}

  getRunnerFor(workspace: string): CursorRunner {
    let runner = this.runners.get(workspace);
    if (!runner) {
      runner = new CursorRunner();
      this.runners.set(workspace, runner);
    }
    return runner;
  }

  isBusy(workspace: string): boolean {
    return this.active.has(workspace) || this.getRunnerFor(workspace).isBusy;
  }

  anyBusy(): boolean {
    return this.active.size > 0 || [...this.runners.values()].some((r) => r.isBusy);
  }

  activeCount(): number {
    return this.active.size;
  }

  hasCapacity(): boolean {
    return this.activeCount() < this.maxConcurrent;
  }

  listBusy(): BusyRun[] {
    return [...this.active.values()];
  }

  markRunning(workspace: string, projectKey: string): void {
    this.active.set(workspace, { workspace, projectKey });
  }

  markIdle(workspace: string): void {
    this.active.delete(workspace);
  }

  /**
   * Atomically claim a slot for `workspace`. Returns false if that path is
   * already busy or the global concurrency cap is reached.
   */
  tryAcquire(workspace: string, projectKey: string): boolean {
    if (this.isBusy(workspace)) return false;
    if (!this.hasCapacity()) return false;
    this.markRunning(workspace, projectKey);
    return true;
  }

  stop(workspace: string): boolean {
    const wasActive = this.active.has(workspace);
    const stopped = this.getRunnerFor(workspace).stop();
    return wasActive || stopped;
  }

  stopAll(): void {
    const workspaces = new Set([...this.active.keys(), ...this.runners.keys()]);
    for (const workspace of workspaces) {
      this.getRunnerFor(workspace).stop();
    }
  }

  /**
   * Run on an already-acquired workspace slot. Caller must have called
   * `tryAcquire` (or `markRunning`) first; this releases the slot in `finally`.
   */
  async runAcquired(options: CursorRunOptions): Promise<CursorRunResult> {
    const { workspace } = options;
    if (!this.active.has(workspace)) {
      throw new CursorBusyError();
    }
    try {
      return await this.getRunnerFor(workspace).run(options);
    } finally {
      this.markIdle(workspace);
    }
  }

  async run(options: CursorRunOptions): Promise<CursorRunResult> {
    const { workspace, projectKey } = options;
    if (!this.tryAcquire(workspace, projectKey)) {
      throw new CursorBusyError();
    }
    return this.runAcquired(options);
  }
}
