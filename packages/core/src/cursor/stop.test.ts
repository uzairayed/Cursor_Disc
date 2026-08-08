import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorRunner } from "./runner.js";

describe("CursorRunner.stop SIGKILL fallback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends SIGKILL when the process has not exited after SIGTERM", () => {
    vi.useFakeTimers();
    const runner = new CursorRunner();
    const signals: string[] = [];
    const proc = {
      killed: true, // true as soon as SIGTERM is *sent*
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: (sig: NodeJS.Signals) => {
        signals.push(sig);
      },
    };
    (runner as unknown as { child: typeof proc }).child = proc;

    expect(runner.stop()).toBe(true);
    expect(signals).toEqual(["SIGTERM"]);

    vi.advanceTimersByTime(3000);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("does not SIGKILL when the process already exited", () => {
    vi.useFakeTimers();
    const runner = new CursorRunner();
    const signals: string[] = [];
    const proc = {
      killed: true,
      exitCode: 0 as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: (sig: NodeJS.Signals) => {
        signals.push(sig);
      },
    };
    (runner as unknown as { child: typeof proc }).child = proc;

    runner.stop();
    vi.advanceTimersByTime(3000);
    expect(signals).toEqual(["SIGTERM"]);
  });
});
