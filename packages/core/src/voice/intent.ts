export type VoiceIntent =
  | { kind: "datetime" }
  | { kind: "mail" }
  | { kind: "command"; text: string }
  | { kind: "agent"; text: string };

const DATETIME =
  /\b(what('?s| is) (the )?(date|time)( today| now)?|what('?s| is) today'?s date|what time is it|tell me the (date|time)|date and time|current (date|time)|today'?s date)\b/i;

const MAIL =
  /\b(check my (e-?mail|inbox)|any unread (e-?mail|mail|messages?)|summarize my (inbox|e-?mail)|new e-?mails?|unread (e-?mail|mail)|read my (e-?mail|inbox))\b/i;

const COMMANDS =
  /^(help|hi|hello|status|stop|stop all|new chat|plan|go|run|cancel plan|projects|current|what project am i on\??)(\b|$)/i;

const SWITCH = /^(switch to|use|open)\s+\S+/i;

/** Bot TTS / acoustic-echo fragments that must not become Cursor prompts. */
const ECHO =
  /\b(listening|working on it|ask me the date|check your email|give me a cursor|talk when ready|sorry,? i couldn'?t|gmail not connected|ready\.?$)\b/i;

export function isEchoTranscript(raw: string): boolean {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return false;
  if (ECHO.test(text)) return true;
  // Whisper often mangled the greeting into short nonsense starting with "listening"
  if (/^listening\b/i.test(text) && text.length < 48) return true;
  return false;
}

/** Soft barge-in while the bot is talking (half-duplex safe). */
export function isInterruptIntent(raw: string): boolean {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return /^(stop|stop all|cancel|shut up|quiet|enough|never ?mind|forget it)[.!]?$/.test(
    text
  );
}

/** Fragments too short/incomplete to burn a Cursor agent turn. */
export function isTooThinForAgent(raw: string): boolean {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && text.length < 24) return true;
  // Cut off mid-thought — wait for coalesced follow-up instead
  if (/\b(for|to|and|or|the|a|an|of|in|with|about|from)\.?\.\.?$/i.test(text))
    return true;
  if (/\b(for|to|and|or|with|about|from)$/i.test(text)) return true;
  if (text.endsWith("...") && words.length < 8) return true;
  return false;
}

export function classifyVoiceIntent(raw: string): VoiceIntent {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return { kind: "agent", text: "" };

  if (DATETIME.test(text)) return { kind: "datetime" };
  if (MAIL.test(text)) return { kind: "mail" };

  const lower = text.toLowerCase();
  if (COMMANDS.test(lower) || SWITCH.test(lower)) {
    return { kind: "command", text: lower };
  }

  // Bare project pick numbers / keys often come through voice as commands too
  if (/^\d{1,2}$/.test(lower)) return { kind: "command", text: lower };

  return { kind: "agent", text };
}
