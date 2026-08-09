import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn(() => ({ on: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const { killProcessTree } = await import("./kill-tree.js");

const realPlatform = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

function fakeChild(pid: number | undefined) {
  return { pid, kill: vi.fn() } as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  setPlatform(realPlatform);
  spawnMock.mockClear();
});

describe("killProcessTree", () => {
  it("signals the child directly on posix", () => {
    setPlatform("linux");
    const child = fakeChild(123);

    killProcessTree(child);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    killProcessTree(child, { force: true });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("walks the tree with taskkill on Windows so shim grandchildren die too", () => {
    setPlatform("win32");
    const child = fakeChild(123);

    killProcessTree(child);
    expect(spawnMock).toHaveBeenCalledWith("taskkill", ["/pid", "123", "/t"], {
      stdio: "ignore",
    });
    expect(child.kill).not.toHaveBeenCalled();

    killProcessTree(child, { force: true });
    expect(spawnMock).toHaveBeenLastCalledWith("taskkill", ["/pid", "123", "/t", "/f"], {
      stdio: "ignore",
    });
  });

  it("falls back to a signal when the child never got a pid", () => {
    setPlatform("win32");
    const child = fakeChild(undefined);

    killProcessTree(child);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
