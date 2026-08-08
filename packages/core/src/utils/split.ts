/** Split long text into platform-safe chunks without breaking mid-line when possible. */
export function splitMessage(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf("\n", maxChars);
    if (cut < maxChars * 0.5) cut = remaining.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;

    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
