/**
 * Convert bot status markup (*bold*) into Discord markdown (**bold**),
 * while leaving fenced/inline code untouched. Cursor markdown mostly passes through.
 */
export function formatForDiscord(input: string): string {
  const fences: string[] = [];
  const inlines: string[] = [];
  let text = input.replace(/\r\n/g, "\n");

  text = text.replace(/```([\s\S]*?)```/g, (_m, body: string) => {
    const idx = fences.length;
    fences.push("```" + body + "```");
    return `\u0000FENCE${idx}\u0000`;
  });

  text = text.replace(/`([^`\n]+)`/g, (_m, body: string) => {
    const idx = inlines.length;
    inlines.push("`" + body + "`");
    return `\u0000INLINE${idx}\u0000`;
  });

  // Already Discord-bold — leave alone
  // Convert WhatsApp-style *bold* (single asterisks) → **bold**
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,]|$)/gm, "$1**$2**");

  text = text.replace(/\u0000INLINE(\d+)\u0000/g, (_m, i) => inlines[Number(i)] ?? "");
  text = text.replace(/\u0000FENCE(\d+)\u0000/g, (_m, i) => fences[Number(i)] ?? "");

  return text.trim();
}
