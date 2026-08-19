export type VoiceIntent =
  | { kind: "datetime" }
  | { kind: "command"; text: string }
  | { kind: "agent"; text: string };

// Anchored to the full utterance: "what's the date of the last commit" or
// "fix the current time formatting" must reach the agent, not the clock.
const DATETIME =
  /^(?:hey|hi|okay|ok|so|um|uh|please)?[,\s]*(?:what('?s| is) (the )?(date|time)( today| now)?|what('?s| is) today'?s date|what time is it|tell me the (date|time)( and (date|time))?|date and time|current (date|time)|today'?s date)[\s?.!]*$/i;

const COMMANDS =
  /^(help|hi|hello|status|stop|stop all|new chat|plan|go|run|cancel plan|projects|current|what project am i on\??)(\b|$)/i;

const SWITCH = /^(switch to|use|open)\s+\S+/i;

/** Bot TTS / acoustic-echo fragments that must not become Cursor prompts. */
const ECHO =
  /\b(listening|working on it|ask me the date|give me a cursor|talk when ready|sorry,? i couldn'?t|ready\.?$)\b/i;

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
  return /^(stop|stop all|cancel|shut up|quiet|enough|never ?mind|forget it)[.!]?$/.test(text);
}

/**
 * Stop-word anywhere in the transcript. Barge-in speech is rarely a clean
 * "stop" — it's "okay stop", "please stop talking", or a stop word buried in
 * an echo-merged transcript of the bot's own reply.
 */
export function containsInterruptIntent(raw: string): boolean {
  return /\b(stop|cancel|shut up|quiet|enough|never ?mind|forget it)\b/i.test(raw);
}

/**
 * Transcript that is mostly words the bot itself just spoke — acoustic echo
 * picked up from speakers. Word-overlap, so it works on partial echoes.
 */
export function isEchoOfSpokenReply(transcript: string, spoken: string): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const heard = words(transcript);
  // Too short to judge — short repeats ("yes", project names) must pass through.
  if (heard.length < 3) return false;
  const said = new Set(words(spoken));
  const hits = heard.filter((w) => said.has(w)).length;
  return hits / heard.length >= 0.6;
}

/** Fragments too short/incomplete to burn a Cursor agent turn. */
export function isTooThinForAgent(raw: string): boolean {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && text.length < 24) return true;
  // Cut off mid-thought — wait for coalesced follow-up instead
  if (/\b(for|to|and|or|the|a|an|of|in|with|about|from)\.?\.\.?$/i.test(text)) return true;
  if (/\b(for|to|and|or|with|about|from)$/i.test(text)) return true;
  if (text.endsWith("...") && words.length < 8) return true;
  return false;
}

export function classifyVoiceIntent(raw: string): VoiceIntent {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return { kind: "agent", text: "" };

  if (DATETIME.test(text)) return { kind: "datetime" };

  const lower = text.toLowerCase();
  if (COMMANDS.test(lower) || SWITCH.test(lower)) {
    return { kind: "command", text: lower };
  }

  // Bare project pick numbers / keys often come through voice as commands too
  if (/^\d{1,2}$/.test(lower)) return { kind: "command", text: lower };

  return { kind: "agent", text };
}
