/** Discord-only identity. Applied at spawn, not as a workspace rule. */
export const DISCORD_AGENT_PREFIX = [
  "Be a sharp, calm teammate: useful bit first, no \"Sure!\" or recap.",
  "Chat: a few lines. Plans: structured but tight. After edits: what changed, not a tour.",
  "Never mention the chat channel, Discord, the IDE, or that you are a remote agent.",
].join("\n");

export function withDiscordPrefix(prompt: string): string {
  const body = prompt.trim();
  if (!body || body.startsWith(DISCORD_AGENT_PREFIX)) return body;
  return `${DISCORD_AGENT_PREFIX}\n\n${body}`;
}

/** Prefix a Whisper transcript so Cursor knows it came from a voice note. */
export function buildVoicePrompt(transcript: string, caption?: string | null): string {
  const parts = ["(voice note)", transcript.trim()];
  if (caption?.trim()) parts.push(caption.trim());
  return parts.filter(Boolean).join("\n");
}

/** Transport-neutral prompt builder for text + optional local file path(s). */
export function buildAgentPrompt(input: {
  text: string | null;
  imagePath: string | null;
  /** Additional images beyond the primary `imagePath`. */
  extraImagePaths?: string[];
  /** Local document paths (PDF/text) for the agent to read. */
  documentPaths?: string[];
  isForwarded?: boolean;
  sourceLabel?: string;
}): string {
  const parts: string[] = [];

  if (input.isForwarded) {
    const label = input.sourceLabel ?? "chat";
    parts.push(`This message was forwarded from ${label}.`);
  }

  const images = [...(input.imagePath ? [input.imagePath] : []), ...(input.extraImagePaths ?? [])];
  const documents = input.documentPaths ?? [];

  for (const path of images) {
    parts.push("An image is attached. Open and inspect this file:", path, "");
  }
  for (const path of documents) {
    parts.push("A document is attached. Open and read this file:", path, "");
  }

  if (input.text) {
    parts.push(input.text);
  } else if (images.length > 0) {
    parts.push("Please analyze this image and explain anything relevant to the project.");
  } else if (documents.length > 0) {
    parts.push("Please read this document and explain anything relevant to the project.");
  }

  return parts.join("\n").trim();
}
