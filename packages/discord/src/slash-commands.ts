import {
  ApplicationCommandOptionType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

/** Slash command JSON bodies registered with Discord on startup. */
export function buildSlashCommandBodies(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [
    {
      name: "prompt",
      description: "Run Cursor Agent (can edit code). No @mention needed.",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "text",
          description: "What you want Cursor to do",
          required: true,
        },
      ],
    },
    {
      name: "ask",
      description: "Ask Cursor a question (read-only — no edits)",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "prompt",
          description: "Your question",
          required: true,
        },
      ],
    },
    {
      name: "help",
      description: "Show how to use the Cursor bridge",
    },
    {
      name: "status",
      description: "Check whether Cursor is still working",
    },
    {
      name: "stop",
      description: "Cancel the current project's run and its queue",
    },
    {
      name: "stop_all",
      description: "Cancel every agent and clear all queues",
    },
    {
      name: "new_chat",
      description: "Start a fresh Cursor chat for this channel/thread",
    },
    {
      name: "project",
      description: "Show or switch the active project",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "name",
          description: "Project key to switch to (omit to show current)",
          required: false,
        },
      ],
    },
    {
      name: "plan",
      description: "Enter plan mode for a held large prompt",
    },
    {
      name: "go",
      description: "Implement the pending plan",
    },
    {
      name: "run",
      description: "Run a held large prompt without planning first",
    },
    {
      name: "cancel_plan",
      description: "Drop the pending plan / held large prompt",
    },
    {
      name: "preview",
      description: "Tunnel to local app — starts npm run dev if needed (phone / anywhere)",
      options: [
        {
          type: ApplicationCommandOptionType.Integer,
          name: "port",
          description: "Local port (default from projects.json / PREVIEW_DEFAULT_PORT)",
          required: false,
          min_value: 1,
          max_value: 65535,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: "path",
          description: "URL path to open (e.g. /playground)",
          required: false,
        },
      ],
    },
    {
      name: "preview_pick",
      description: "Preview with element picker on — click UI, Copy, paste into Discord",
      options: [
        {
          type: ApplicationCommandOptionType.Integer,
          name: "port",
          description: "Local port (default from projects.json / PREVIEW_DEFAULT_PORT)",
          required: false,
          min_value: 1,
          max_value: 65535,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: "path",
          description: "URL path to open (e.g. /playground)",
          required: false,
        },
      ],
    },
    {
      name: "preview_stop",
      description: "Stop the public preview tunnel for this project",
    },
    {
      name: "join",
      description: "Join your current voice channel as a personal assistant",
    },
    {
      name: "leave",
      description: "Leave the voice channel",
    },
    {
      name: "voice_status",
      description: "Show whether the bot is in a voice channel",
    },
    {
      name: "bridge",
      description: "Multi-machine bridge lease: status or take ownership",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "status",
          description: "Show which machine currently owns the bridge",
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "take",
          description: "Switch the active bridge to this machine",
        },
      ],
    },
  ];
}

/**
 * Map a Discord slash command to the same conversational text the message
 * router already understands (help, stop, switch to X, free-form prompts, …).
 */
export function promptFromSlashCommand(opts: {
  commandName: string;
  getString: (name: string) => string | null;
}): string | null {
  const { commandName, getString } = opts;

  switch (commandName) {
    case "prompt": {
      const text = getString("text")?.trim();
      return text || null;
    }
    case "ask": {
      const prompt = getString("prompt")?.trim();
      return prompt || null;
    }
    case "help":
      return "help";
    case "status":
      return "status";
    case "stop":
      return "stop";
    case "stop_all":
      return "stop all";
    case "new_chat":
      return "new chat";
    case "project": {
      const name = getString("name")?.trim();
      return name ? `switch to ${name}` : "current";
    }
    case "plan":
      return "plan";
    case "go":
      return "go";
    case "run":
      return "run";
    case "cancel_plan":
      return "cancel plan";
    case "preview":
    case "preview_pick":
    case "preview_stop":
    case "join":
    case "leave":
    case "voice_status":
    case "bridge":
      // Handled by voice / preview / lease adapters; not routed to Cursor.
      return null;
    default:
      return null;
  }
}
