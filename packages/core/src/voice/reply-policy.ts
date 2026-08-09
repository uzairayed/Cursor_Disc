const MAX_SPOKEN = 280;
const DEFAULT_CHUNK = 450;
const DEFAULT_MAX_SPOKEN = 1600;

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_>~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prepare text for TTS: strip code fences, collapse whitespace, truncate. */
export function spokenReplyFromText(text: string, maxChars: number = MAX_SPOKEN): string {
  const cleaned = cleanForSpeech(text);
  if (!cleaned) return "Done.";
  if (cleaned.length <= maxChars) return cleaned;

  const slice = cleaned.slice(0, maxChars - 1);
  const breakAt = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(" "));
  const cut = breakAt > maxChars * 0.5 ? slice.slice(0, breakAt + 1).trim() : slice.trim();
  return `${cut}…`;
}

/**
 * Split a long reply into TTS-sized chunks so voice can finish the answer
 * instead of cutting off after ~280 characters.
 */
export function spokenChunksFromText(
  text: string,
  opts: { chunkChars?: number; maxChars?: number } = {},
): string[] {
  const chunkChars = opts.chunkChars ?? DEFAULT_CHUNK;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_SPOKEN;
  const cleaned = cleanForSpeech(text);
  if (!cleaned) return ["Done."];

  const limited =
    cleaned.length > maxChars
      ? `${cleaned
          .slice(0, maxChars - 1)
          .replace(/\s+\S*$/, "")
          .trim()}…`
      : cleaned;

  if (limited.length <= chunkChars) return [limited];

  const sentences = limited.split(/(?<=[.!?。؟])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      if (sentence.length <= chunkChars) {
        current = sentence;
      } else {
        // Hard-wrap very long sentence
        for (let i = 0; i < sentence.length; i += chunkChars) {
          chunks.push(sentence.slice(i, i + chunkChars).trim());
        }
        current = "";
      }
      continue;
    }
    if (`${current} ${sentence}`.length <= chunkChars) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence.length <= chunkChars ? sentence : "";
      if (sentence.length > chunkChars) {
        for (let i = 0; i < sentence.length; i += chunkChars) {
          chunks.push(sentence.slice(i, i + chunkChars).trim());
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}
