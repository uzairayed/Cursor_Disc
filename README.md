# Cursor Discord Bridge

Text [Cursor Agent](https://cursor.com) from Discord (DMs, server channels, and threads). Runs locally on your Mac.

Monorepo layout:

| Package | Role |
|---|---|
| `@cursor-bridge/core` | Shared router, queue, Cursor runner, projects, commands |
| `@cursor-bridge/discord` | Discord adapter + process entry |

Core is Discord-focused. A future WhatsApp adapter can re-port channel formatting from `cursor_wa` when that package lands.

## Setup

Step-by-step local install (bot, IDs, env, first DM): **[SETUP.md](./SETUP.md)**.

Short version:

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot**: create a bot, copy the token, and enable the **Message Content Intent**.
3. Invite the bot with **`bot`** + **`applications.commands`** scopes, and permissions: View Channels, Send Messages, Read Message History, Add Reactions, Attach Files, **Manage Channels** (to auto-create per-project channels), Create Public Threads, Send Messages in Threads, **Connect**, **Speak**, **Use Voice Activity**.
4. Copy your Discord user ID (and channel / parent-channel IDs for servers).
5. For the voice assistant: `brew install ffmpeg` (TTS playback), set `OPENAI_API_KEY`, and optionally configure Gmail (see Voice assistant below).

```bash
npm install
cp .env.example .env.local
# Edit .env.local — DISCORD_BOT_TOKEN + DISCORD_ALLOWED_USER_IDS (required)
# cp projects.example.json projects.json  # then edit paths/aliases
npm test
npm run dev
```

## Talking to the bridge

### Slash commands (recommended)

Type `/` in Discord — the bot registers these on startup (guilds in `DISCORD_ALLOWED_GUILD_IDS` get them instantly):

| Command | What happens |
|---|---|
| `/prompt text:` | Run Cursor **agent** (can edit) — no @mention needed; opens a thread in server channels |
| `/ask prompt:` | Cursor **ask mode** (read-only Q&A — no edits) |
| `/help` | Show help + project picker |
| `/status` | Check whether a run is in progress |
| `/stop` | Cancel the current project's run and its queue |
| `/stop_all` | Cancel every agent and clear all queues |
| `/new_chat` | Fresh Cursor session for this channel/thread |
| `/project` `[name]` | Show current project, or switch / open a project channel |
| `/plan` `/go` `/run` `/cancel_plan` | Plan-first flow controls |
| `/preview` `[port]` `[path]` | Cloudflare tunnel to the project's local dev server (phone / anywhere) |
| `/preview_pick` `[port]` `[path]` | Same tunnel, opens with the AI element picker (`?pick=1`) |
| `/preview_stop` | Close that project's preview tunnel |
| `/join` | Join your current voice channel as a personal assistant |
| `/leave` | Leave the voice channel |
| `/voice_status` | Whether the bot is in a VC |
| `/gmail_auth` | Ephemeral Gmail read-only OAuth link |
| `/gmail_code` | Finish Gmail OAuth with the authorization code |

No `@mention` needed for slash commands. Re-invite with `applications.commands` if they don’t appear.

### Mentions / plain text

- **Server channels:** @mention the bot, or use `/prompt`
- **Threads + DMs:** just type — no @mention needed


If you **Reply** to a message and @mention the bot, the quoted message’s text (and attachment names) are included in the prompt so Cursor can read that context.

While a job runs, Discord edits a progress message in place (stacked live steps + heartbeats) so you don’t get a flood of notifications. If that message fills up, a new one continues the log — nothing is dropped.

Plain-text phrases still work:

| You say | What happens |
|---|---|
| `help` / `hi` | Show help + project picker |
| `1` / `cliproom` / `switch to tagiser` | Pick or switch project |
| `projects` | Show the project picker again |
| `what project am I on?` | Show the current project |
| `new chat` | Start a fresh Cursor thread for this project |
| `status` | Check whether a run is in progress |
| `stop` | Cancel the current project's run and its queue |
| `stop all` | Cancel every agent and clear all queues |
| `plan` | Enter plan mode for a held large prompt |
| `run` | Send a held large prompt straight to the agent |
| `go` / react ✅ on the plan | Implement the last plan |
| `cancel plan` | Drop a waiting plan / large prompt |
| _(anything else)_ | Queue or run a Cursor Agent prompt |

Large prompts (≥400 chars, multi-step lists, or image + long caption) are held first — the bot asks you to reply **plan** (recommended) or **run**.

Also works with image attachments and audio (Whisper when `OPENAI_API_KEY` is set).

### Threads

- **Server channels:** each message starts (or continues) a Discord thread. All bot replies for that chat stay in the thread. Keep talking in the thread to continue the same Cursor session; a new top-level channel message starts a new thread/chat.
- **DMs:** Discord has no real threads, so the bot uses message replies nested under your message. The whole DM is one conversation.

### General vs project (important)

| Surface | Workspace | What you can do |
|---|---|---|
| DM or `#general` | local `general/` folder | Open-ended AI / questions |
| `#project-name` | that code project | Project work only (channel is locked) |

- Ask general things in **GENERAL** (DM or `#general`).
- Say `switch to cliproom` from general → bot creates/opens `#cliproom` and **tags it**; continue the project conversation there.
- Project prompts are not run outside that project’s channel.
- First time a project is selected, the bot creates `#project-name` (needs **Manage Channels**). Mapping: `discord-project-channels.json`.

## Authorization

| Surface | Required |
|---|---|
| DM | User ID in `DISCORD_ALLOWED_USER_IDS` |
| Server channel | User allowlisted **and** channel ID in `DISCORD_ALLOWED_CHANNEL_IDS` |
| Thread | User allowlisted **and** (thread ID **or** parent channel ID) allowlisted |
| Bot messages | Always ignored |

## Voice assistant (`/join`)

Join a server voice channel, then run `/join`. The bot listens only to allowlisted users, transcribes speech (OpenAI), and can:

- Answer date/time
- Run bridge commands (`status`, `stop`, project switch, …)
- Summarize unread Gmail (read-only)
- Send other requests to Cursor Agent (speaks a short summary; full text goes to the text channel where you ran `/join`)

| Need | Notes |
|---|---|
| `OPENAI_API_KEY` | STT (`gpt-4o-mini-transcribe`) + TTS (`tts-1`) |
| `ffmpeg` | `brew install ffmpeg` for Discord TTS playback |
| Discord perms | Connect, Speak, Use Voice Activity + `GuildVoiceStates` intent (already in code) |
| Gmail (optional) | `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` → `npm run gmail:auth` or `/gmail_auth` + `/gmail_code` |

**Voice tips:** headphones, short pause after you finish, say **stop** to interrupt, watch `🎤 Heard:` in text. Half-duplex on purpose (Discord has no echo cancel into the bot).

Latency: Realtime Whisper STT by default (`VOICE_STT_MODE=realtime`, same `OPENAI_API_KEY`, ~$0.017/min; falls back to batch), ~1.1s silence end, adaptive coalesce. Set `VOICE_STT_MODE=batch` for cheaper/slower STT.

Approx. cost at light use (~15 min speech/day): **~$2–5/month** OpenAI. See [`VOICE_ASSISTANT_SPEC.md`](./VOICE_ASSISTANT_SPEC.md).

## Remote preview (`/preview`)

When you're away from the Mac's Wi‑Fi, `/preview` opens a short-lived [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to the project's local dev server and posts a public `*.trycloudflare.com` link in Discord.

1. Install once on the Mac: `brew install cloudflared`
2. In that project's Discord channel: `/preview` (normal) or `/preview_pick` (element picker)
3. The bridge checks `localhost:<port>`; if nothing is listening it runs `npm run dev` in the project folder and waits until the port is up
4. Then it opens a Cloudflare tunnel and posts the public link
5. Open the link on your phone — Cursor's browser can use the same URL
6. With `/preview_pick`: click a UI element → **Copy** → paste into Discord with your prompt
7. `/preview_stop` closes the tunnel (and stops a `npm run dev` the bridge started)

Port resolution order: slash `port` → `projects.json` `previewPorts` → `PREVIEW_PORTS` env → `PREVIEW_DEFAULT_PORT` (3000).

A listening port is reused only if it belongs to **this** project's folder (checked via the process cwd). If another app already owns the preferred port, preview picks the next free port and starts `npm run dev` there.

## Notes

- Up to **3** Cursor agents can run in parallel when they target **different** project directories; prompts for the same directory are queued (up to 5 per directory).
- `stop` cancels only the current project; `stop all` cancels every agent and clears all queues.
- Conversation history is stored per project under `history/<project>/`.
- Run logs go to `logs/YYYY-MM-DD.jsonl`.
- The process refuses to start if the bot token or user allowlist is empty.
- Edits to `projects.json` are picked up on the next picker/switch without restart.
- Inbox media and old logs older than `RETENTION_DAYS` are cleaned up on startup.
- Preview tunnels die if the Mac sleeps or the bridge process exits.

## Scripts

```bash
npm test          # core + discord tests
npm run typecheck
npm run build
npm run dev       # start Discord bridge (tsx)
npm start         # start from dist/
```
