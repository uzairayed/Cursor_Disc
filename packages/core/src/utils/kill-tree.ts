import { type ChildProcess, spawn } from "node:child_process";

/**
 * End a child and anything it started.
 *
 * On Windows the binaries we spawn (`cursor`, `npm`) are .cmd shims, so the
 * process we hold is cmd.exe and the real worker is a grandchild — signalling
 * the shim leaves a `--force` agent running after the user said stop. `taskkill
 * /T` walks the tree. POSIX has no shim, so a direct signal is enough.
 *
 * `force` maps to SIGKILL / `/F` for the escalation callers already do after a
 * grace period.
 */
export function killProcessTree(child: ChildProcess, opts: { force?: boolean } = {}): void {
  const force = Boolean(opts.force);
  const signal: NodeJS.Signals = force ? "SIGKILL" : "SIGTERM";

  if (process.platform !== "win32" || child.pid == null) {
    child.kill(signal);
    return;
  }

  const args = ["/pid", String(child.pid), "/t"];
  if (force) args.push("/f");
  try {
    // taskkill.exe is a real binary, so plain spawn is fine here.
    const killer = spawn("taskkill", args, { stdio: "ignore" });
    killer.on("error", () => child.kill(signal));
  } catch {
    child.kill(signal);
  }
}
