import type { CursorExecutionMode } from "../cursor/runner.js";

/**
 * Ask mode is read-only and blocks web search in Cursor CLI.
 * Use agent when the user clearly needs live / external lookup.
 */
const NEEDS_LIVE =
  /\b(news|headline|headlines|traffic|weather|forecast|latest|today|tonight|breaking|search|look\s*up|google|stock|score|scores|price|prices|outage|blackout|protest|election|match|fixture|inbox|e-?mail|gmail)\b/i;

const NEEDS_LIVE_UR =
  /(خبر|اخبار|موسم|ٹریفک|تازہ|آج|ای میل)/;

export function generalExecutionMode(prompt: string): CursorExecutionMode {
  const text = prompt.trim();
  if (!text) return "ask";
  if (NEEDS_LIVE.test(text) || NEEDS_LIVE_UR.test(text)) return "agent";
  return "ask";
}
