export function buildWorkingMessage(
  projectKey: string,
  mode: "agent" | "plan" | "ask" = "agent"
): string {
  const name = projectKey.toUpperCase();
  if (mode === "ask") {
    return `On it — *ask mode* (read-only) in *${name}*. Say *stop* to cancel.`;
  }
  if (mode === "plan") {
    return `On it — *plan mode* in *${name}*. Say *stop* to cancel.`;
  }
  return `On it — working in *${name}*. I'll check in as I go. Say *stop* to cancel.`;
}

export function buildStoppedMessage(): string {
  return "Okay, I stopped that.";
}

export function buildBusyStatusMessage(projectKey: string | null): string {
  if (!projectKey) {
    return "Yes — I'm still working. Say *stop* to cancel.";
  }
  return `Yes — still working in *${projectKey.toUpperCase()}*. Say *stop* to cancel.`;
}

export function buildMultiAgentStatusMessage(
  busy: { projectKey: string }[],
  queued:
    | number
    | { projectKey: string; depth: number }[]
): string {
  const lines: string[] = [];
  if (busy.length > 0) {
    const names = busy.map((b) => `*${b.projectKey.toUpperCase()}*`).join(", ");
    lines.push(
      busy.length === 1
        ? `Yes — still working in ${names}.`
        : `Yes — ${busy.length} agents running: ${names}.`
    );
  }

  if (typeof queued === "number") {
    if (queued > 0) {
      lines.push(
        `${queued} task${queued === 1 ? "" : "s"} queued across projects.`
      );
    }
  } else if (queued.length > 0) {
    const parts = queued.map(
      (q) => `*${q.projectKey.toUpperCase()}* (${q.depth})`
    );
    lines.push(`Queued: ${parts.join(", ")}.`);
  }

  lines.push("Say *stop* to cancel the current project, or *stop all* for everything.");
  return lines.join("\n");
}

export function buildIdleStatusMessage(): string {
  return "I'm free right now — send a prompt whenever.";
}

export function buildTimedOutMessage(): string {
  return "That took too long, I stopped it — try breaking the task up.";
}
