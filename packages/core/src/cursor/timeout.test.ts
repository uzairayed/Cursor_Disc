import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

// runner.ts spawns via cross-spawn so Windows .cmd shims work.
vi.mock("cross-spawn", () => ({
  default: vi.fn(),
}));

import spawn from "cross-spawn";
import { CursorRunner } from "./runner.js";

function fakeChild(): EventEmitter & {
  killed: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as ReturnType<typeof fakeChild>;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn((sig: NodeJS.Signals) => {
    child.killed = true;
    if (sig === "SIGTERM" || sig === "SIGKILL") {
      child.signalCode = sig;
      queueMicrotask(() => child.emit("close", null));
    }
  });
  return child;
}

describe("CursorRunner.run timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(spawn).mockReset();
  });

  it("kills the process and resolves with timedOut when deadline hits", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const runner = new CursorRunner();
    const promise = runner.run({
      cursorBin: "cursor",
      workspace: process.cwd(),
      prompt: "hi",
      projectKey: "crm",
      conversations: {
        getChatId: () => null,
        setChatId: () => undefined,
      } as never,
      timeoutMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(true);
  });

  it("does not time out when the process finishes first", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const runner = new CursorRunner();
    const promise = runner.run({
      cursorBin: "cursor",
      workspace: process.cwd(),
      prompt: "hi",
      projectKey: "crm",
      conversations: {
        getChatId: () => null,
        setChatId: () => undefined,
      } as never,
      timeoutMs: 60_000,
    });

    child.emit("close", 0);
    const result = await promise;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(result.timedOut).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
