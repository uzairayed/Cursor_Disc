import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probeLocalPort } from "./tunnel.js";

describe("probeLocalPort", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
          })
      )
    );
  });

  it("returns false when nothing is listening", async () => {
    expect(await probeLocalPort(59_999, { timeoutMs: 300 })).toBe(false);
  });

  it("returns true when a TCP server accepts connections", async () => {
    const server = createServer((socket) => socket.end());
    servers.push(server);
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("no port"));
      });
    });
    expect(await probeLocalPort(port, { timeoutMs: 500 })).toBe(true);
  });
});
