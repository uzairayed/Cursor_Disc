import { execFile } from "node:child_process";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ExecFileFn = (
  file: string,
  args: readonly string[]
) => Promise<{ stdout: string; stderr: string }>;

/** Parse PID of the first LISTEN row from `lsof -iTCP:PORT -sTCP:LISTEN`. */
export function parseListeningPid(lsofListenOutput: string): number | null {
  for (const line of lsofListenOutput.split("\n")) {
    if (!line || line.startsWith("COMMAND") || !/\(LISTEN\)/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number.parseInt(parts[1] ?? "", 10);
    if (Number.isFinite(pid) && pid > 0) return pid;
  }
  return null;
}

/** Parse cwd path from `lsof -a -d cwd -p PID`. */
export function parseProcessCwd(lsofCwdOutput: string): string | null {
  for (const line of lsofCwdOutput.split("\n")) {
    if (!line || line.startsWith("COMMAND")) continue;
    const marker = " cwd ";
    const idx = line.toLowerCase().indexOf(marker);
    if (idx === -1) continue;
    // After TYPE/DEVICE columns the path is last; take everything after "DIR"/"unknown"
    const after = line.slice(idx + marker.length).trim();
    const pathMatch = after.match(/(\/[^\s].*)$/);
    if (pathMatch?.[1]) return pathMatch[1].trim();
  }
  // Fallback: last whitespace token that looks like an absolute path
  for (const line of lsofCwdOutput.split("\n")) {
    if (!line || line.startsWith("COMMAND")) continue;
    const token = line.trim().split(/\s+/).pop();
    if (token?.startsWith("/")) return token;
  }
  return null;
}

export function isSameProjectPath(listenerCwd: string, projectPath: string): boolean {
  const a = resolve(listenerCwd);
  const b = resolve(projectPath);
  if (a === b) return true;
  const prefixA = a.endsWith(sep) ? a : a + sep;
  const prefixB = b.endsWith(sep) ? b : b + sep;
  return a.startsWith(prefixB) || b.startsWith(prefixA);
}

export interface PortOwner {
  pid: number;
  cwd: string;
}

/** Resolve which project directory owns the process listening on localhost:port. */
export async function inspectPortOwner(
  port: number,
  opts: { execFile?: ExecFileFn } = {}
): Promise<PortOwner | null> {
  const run = opts.execFile ?? defaultExecFile;
  try {
    const listen = await run("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
    ]);
    const pid = parseListeningPid(listen.stdout);
    if (pid == null) return null;

    const cwdOut = await run("lsof", ["-a", "-d", "cwd", "-p", String(pid)]);
    const cwd = parseProcessCwd(cwdOut.stdout);
    if (!cwd) return null;
    return { pid, cwd };
  } catch {
    return null;
  }
}

export async function portBelongsToProject(
  port: number,
  projectPath: string,
  opts: {
    execFile?: ExecFileFn;
    inspect?: (port: number) => Promise<PortOwner | null>;
  } = {}
): Promise<boolean> {
  const owner = opts.inspect
    ? await opts.inspect(port)
    : await inspectPortOwner(port, { execFile: opts.execFile });
  if (!owner) return false;
  return isSameProjectPath(owner.cwd, projectPath);
}

async function defaultExecFile(
  file: string,
  args: readonly string[]
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(file, [...args], {
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
  } catch (err) {
    // lsof exits 1 when nothing matches — treat as empty
    const e = err as { stdout?: string; stderr?: string; code?: number };
    if (typeof e.stdout === "string") {
      return { stdout: e.stdout, stderr: e.stderr ?? "" };
    }
    throw err;
  }
}
