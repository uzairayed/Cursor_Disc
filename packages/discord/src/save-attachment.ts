import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

export type AttachmentKind = "image" | "audio" | "unsupported";

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);
const AUDIO_TYPES = new Set([
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/mp4",
  "audio/m4a",
]);
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const AUDIO_EXT = /\.(ogg|mp3|wav|webm|m4a|mp4|opus)$/i;

export function classifyAttachment(meta: {
  contentType?: string | null;
  name?: string | null;
}): AttachmentKind {
  const type = meta.contentType?.toLowerCase() ?? "";
  const name = meta.name ?? "";
  if (IMAGE_TYPES.has(type) || IMAGE_EXT.test(name)) return "image";
  if (AUDIO_TYPES.has(type) || AUDIO_EXT.test(name)) return "audio";
  return "unsupported";
}

export type AttachmentCheck =
  | { ok: true; kind: "image" | "audio" }
  | { ok: false; reason: "too_large" | "unsupported" };

export function isAllowedAttachment(meta: {
  contentType?: string | null;
  name?: string | null;
  size: number;
}): AttachmentCheck {
  if (meta.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "too_large" };
  const kind = classifyAttachment(meta);
  if (kind === "unsupported") return { ok: false, reason: "unsupported" };
  return { ok: true, kind };
}

export async function saveDiscordAttachment(opts: {
  url: string;
  fileName: string;
  destDir: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  await mkdir(opts.destDir, { recursive: true });
  const dest = join(opts.destDir, opts.fileName);

  const res = await fetchImpl(opts.url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download attachment (${res.status})`);
  }

  const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  await pipeline(nodeStream, createWriteStream(dest));
  return dest;
}
