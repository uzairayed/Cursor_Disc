/** General/voice chats should not replay a growing Cursor session. */
export function shouldResumeCursorChat(opts: {
  surface?: "general" | "project";
  projectKey: string;
}): boolean {
  if (opts.surface === "general") return false;
  if (opts.projectKey.toLowerCase() === "general") return false;
  return true;
}
