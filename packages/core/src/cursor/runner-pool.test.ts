import { describe, expect, it, vi } from "vitest";
import { CursorBusyError } from "./runner.js";
import { CursorRunnerPool } from "./runner-pool.js";

describe("CursorRunnerPool", () => {
  it("allows concurrent runs on different workspaces", async () => {
    const pool = new CursorRunnerPool(3);
    const runA = vi.fn(async () => ({
      stdout: "a",
      stderr: "",
      exitCode: 0,
      durationSec: 1,
      chatId: null,
      cancelled: false,
      timedOut: false,
      usage: null,
    }));
    const runB = vi.fn(async () => ({
      stdout: "b",
      stderr: "",
      exitCode: 0,
      durationSec: 1,
      chatId: null,
      cancelled: false,
      timedOut: false,
      usage: null,
    }));

    vi.spyOn(pool, "getRunnerFor").mockImplementation((workspace) => {
      const runner = {
        isBusy: false,
        stop: () => false,
        run: workspace === "/a" ? runA : runB,
      };
      return runner as never;
    });

    await Promise.all([
      pool.run({ workspace: "/a", projectKey: "a" } as never),
      pool.run({ workspace: "/b", projectKey: "b" } as never),
    ]);

    expect(runA).toHaveBeenCalledOnce();
    expect(runB).toHaveBeenCalledOnce();
    expect(pool.activeCount()).toBe(0);
  });

  it("rejects a second run on the same workspace while busy", async () => {
    const pool = new CursorRunnerPool(3);
    const runner = {
      isBusy: true,
      stop: () => false,
      run: vi.fn(),
    };
    vi.spyOn(pool, "getRunnerFor").mockReturnValue(runner as never);

    await expect(pool.run({ workspace: "/a", projectKey: "a" } as never)).rejects.toBeInstanceOf(
      CursorBusyError,
    );
  });

  it("stop(workspace) only stops that workspace runner", () => {
    const pool = new CursorRunnerPool(3);
    let stoppedA = false;
    let stoppedB = false;
    vi.spyOn(pool, "getRunnerFor").mockImplementation((workspace) => {
      if (workspace === "/a") {
        return {
          isBusy: true,
          stop: () => {
            stoppedA = true;
            return true;
          },
          run: vi.fn(),
        } as never;
      }
      return {
        isBusy: true,
        stop: () => {
          stoppedB = true;
          return true;
        },
        run: vi.fn(),
      } as never;
    });

    pool.stop("/a");
    expect(stoppedA).toBe(true);
    expect(stoppedB).toBe(false);
  });

  it("stopAll stops every busy runner", () => {
    const pool = new CursorRunnerPool(3);
    const stopped: string[] = [];
    vi.spyOn(pool, "getRunnerFor").mockImplementation(
      (workspace) =>
        ({
          isBusy: true,
          stop: () => {
            stopped.push(workspace);
            return true;
          },
          run: vi.fn(),
        }) as never,
    );

    pool.markRunning("/a", "a");
    pool.markRunning("/b", "b");
    pool.stopAll();
    expect(stopped.sort()).toEqual(["/a", "/b"]);
  });

  it("tracks active runs and listBusy", () => {
    const pool = new CursorRunnerPool(3);
    pool.markRunning("/a", "crm");
    pool.markRunning("/b", "fleet");
    expect(pool.activeCount()).toBe(2);
    expect(pool.listBusy()).toEqual([
      { workspace: "/a", projectKey: "crm" },
      { workspace: "/b", projectKey: "fleet" },
    ]);
    pool.markIdle("/a");
    expect(pool.activeCount()).toBe(1);
    expect(pool.isBusy("/a")).toBe(false);
    expect(pool.isBusy("/b")).toBe(true);
  });

  it("hasCapacity respects max concurrent", () => {
    const pool = new CursorRunnerPool(3);
    pool.markRunning("/a", "a");
    pool.markRunning("/b", "b");
    pool.markRunning("/c", "c");
    expect(pool.hasCapacity()).toBe(false);
    pool.markIdle("/b");
    expect(pool.hasCapacity()).toBe(true);
  });

  it("run() refuses when global concurrency cap is reached", async () => {
    const pool = new CursorRunnerPool(2);
    pool.markRunning("/a", "a");
    pool.markRunning("/b", "b");
    vi.spyOn(pool, "getRunnerFor").mockReturnValue({
      isBusy: false,
      stop: () => false,
      run: vi.fn(),
    } as never);

    await expect(pool.run({ workspace: "/c", projectKey: "c" } as never)).rejects.toBeInstanceOf(
      CursorBusyError,
    );
  });

  it("tryAcquire is atomic with capacity", () => {
    const pool = new CursorRunnerPool(1);
    expect(pool.tryAcquire("/a", "a")).toBe(true);
    expect(pool.tryAcquire("/b", "b")).toBe(false);
    pool.markIdle("/a");
    expect(pool.tryAcquire("/b", "b")).toBe(true);
  });
});
