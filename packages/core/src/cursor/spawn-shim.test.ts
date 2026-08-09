import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import spawn from "cross-spawn";
import { describe, expect, it } from "vitest";

/**
 * `cursor` and `npm` are .cmd shims on Windows. Node refuses to spawn those
 * directly (EINVAL) and does not escape argv under `shell: true`, which would
 * let a Discord prompt inject commands. This is the check that both hold.
 */
describe.skipIf(process.platform !== "win32")("spawning a Windows .cmd shim", () => {
  it("runs the shim and passes hostile argv through verbatim", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shim-argv-"));
    const shim = join(dir, "argv.cmd");
    writeFileSync(shim, '@node -e "console.log(JSON.stringify(process.argv.slice(1)))" %*\n');

    const args = ["a & echo INJECTED", 'say "hi"', "%PATH%", "b|c^d", "trail\\"];

    const stdout = await new Promise<string>((resolvePromise, reject) => {
      const child = spawn(shim, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout?.on("data", (chunk) => {
        out += chunk;
      });
      child.on("error", reject);
      child.on("close", () => resolvePromise(out.trim()));
    });

    expect(JSON.parse(stdout)).toEqual(args);
  });
});
