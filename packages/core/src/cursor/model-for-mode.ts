import type { CursorExecutionMode } from "./runner.js";

export interface CursorModelConfig {
  cursorPlanModel: string | null;
  cursorAgentModel: string | null;
  cursorAskModel: string | null;
}

/** Pick CLI --model for this execution mode; undefined means Cursor Auto. */
export function modelForExecutionMode(
  config: CursorModelConfig,
  mode: CursorExecutionMode,
): string | undefined {
  if (mode === "plan") return config.cursorPlanModel ?? undefined;
  if (mode === "ask") {
    return config.cursorAskModel ?? config.cursorAgentModel ?? undefined;
  }
  return config.cursorAgentModel ?? undefined;
}
