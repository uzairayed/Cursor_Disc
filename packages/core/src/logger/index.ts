import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface RunLogEntry {
  time: string;
  project: string;
  prompt: string;
  response?: string;
  duration: number;
  exit: number | null;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  platform?: string;
  sourceId?: string;
}

export class RunLogger {
  constructor(private readonly logsDir: string) {
    mkdirSync(logsDir, { recursive: true });
  }

  log(entry: RunLogEntry): void {
    const line = JSON.stringify(entry);
    const day = entry.time.slice(0, 10);
    const file = join(this.logsDir, `${day}.jsonl`);
    appendFileSync(file, `${line}\n`, "utf8");
  }
}
