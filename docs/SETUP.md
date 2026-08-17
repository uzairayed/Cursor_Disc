# Local setup guide

Run the Discord → Cursor bridge on Windows, macOS, or Linux in about 15 minutes.

## What you need

- A machine running Windows 10+, macOS, or Linux
- [Node.js 20+](https://nodejs.org/) (`node -v` should show `v20` or higher)
- [Cursor](https://cursor.com) desktop app, plus the **standalone Agent CLI** (`agent` / `cursor-agent`). The IDE shell command named `cursor` is not enough on its own.
- A Discord account

Optional later (skip for first run):

- `OPENAI_API_KEY`: voice notes + voice assistant
- `ffmpeg`: voice TTS playback
- `cloudflared`: `/preview` tunnels

Install the optional binaries with whatever package manager your OS has:

| OS | ffmpeg | cloudflared |
|---|---|---|
| Windows | `winget install ffmpeg` | `winget install cloudflare.cloudflared` |
| macOS | `brew install ffmpeg` | `brew install cloudflared` |
| Debian/Ubuntu | `sudo apt install ffmpeg` | see [cloudflared downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |

---

## 1. Clone and install

```bash
git clone <this-repo-url>
cd Cursor_Disc
npm install
```

---

## 2. Create a Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → name it anything.
2. Left sidebar → **Bot** → **Add Bot** (or Reset Token if it already exists).
3. Copy the **token**. You’ll paste it into `.env` soon. Don’t share it.
4. On the same Bot page, turn on **Message Content Intent** (under Privileged Gateway Intents). Save.
5. Left sidebar → **OAuth2** → **URL Generator**:
   - Scopes: `bot` and `applications.commands`
   - Bot permissions: View Channels, Send Messages, Read Message History, Add Reactions, Attach Files, Manage Channels, Create Public Threads, Send Messages in Threads  
     (for voice later: also Connect, Speak, Use Voice Activity)
6. Open the generated URL, pick your server, authorize.

---

## 3. Get your Discord IDs

In Discord: **User Settings → App Settings → Advanced → Developer Mode** → ON.

Then:

| What | How |
|---|---|
| Your user ID | Right-click your avatar → **Copy User ID** |
| A channel ID | Right-click the channel → **Copy Channel ID** |
| Server (guild) ID | Right-click the server icon → **Copy Server ID** |

---

## 4. Configure env

```bash
cp .env.example .env.local
```

Edit `.env.local` (preferred for secrets; gitignored). Minimum to start:

```env
DISCORD_BOT_TOKEN=paste-your-bot-token-here
DISCORD_ALLOWED_USER_IDS=your-discord-user-id
```

**DM-only (simplest):** leave channel/guild lists empty. You can DM the bot after it starts.

**Server channels too:** also set:

```env
DISCORD_ALLOWED_GUILD_IDS=your-server-id
DISCORD_ALLOWED_CHANNEL_IDS=channel-id-1,channel-id-2
```

Threads under an allowlisted parent channel work automatically.

Without a bot token or user allowlist, the process refuses to start.

---

## 5. Point it at your projects

Copy the example and edit paths for your machine:

```bash
cp projects.example.json projects.json
```

Example shape (macOS/Linux paths shown; on Windows use e.g. `C:/Users/YOU/projects`):

```json
{
  "dirs": [
    "/Users/YOU/projects"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "build",
    ".next"
  ],
  "aliases": {
    "myapp": "/Users/YOU/projects/myapp",
    "general": "/Users/YOU/path/to/Cursor_Disc/general"
  },
  "previewPorts": {
    "myapp": 3000
  }
}
```

- `dirs`: folders whose child projects show up in the picker  
- `aliases`: short names → absolute paths (use these in Discord: `switch to myapp`)  
- Keep a `general` alias if you want the open-ended workspace

Changes to `projects.json` are picked up on the next project switch; no restart needed.

---

## 6. Confirm Cursor Agent CLI works

The bridge needs the **Agent** CLI, not the Cursor IDE launcher.

```bash
# Prefer this (standalone Agent):
agent --version

# Or on Windows after a normal Cursor install:
"%LOCALAPPDATA%\cursor-agent\agent.cmd" --version
```

If `agent` is missing from PATH, set an absolute path in `.env.local`:

```env
# Windows example
CURSOR_BIN=C:\Users\YOU\AppData\Local\cursor-agent\agent.cmd

# macOS / Linux example (wherever `which agent` points)
CURSOR_BIN=/Users/YOU/.local/bin/agent
```

Do **not** point `CURSOR_BIN` at the IDE `cursor` / `cursor.cmd` shim. That binary opens Electron and ignores Agent flags (`-p`, `--trust`, `--workspace`, …), so Discord gets warnings and no run.

---

## 7. Start the bridge

```bash
npm run dev
```

You should see the Discord client come online (no crash about missing token / allowlist).

Leave this terminal open while you use it.

---

## 8. Mac + PC (one bot, one active machine)

Discord delivers every message to every connected bridge. To keep a single owner across machines, set a shared lease channel (any allowlisted text channel both bots can post in):

```env
BRIDGE_LEASE_CHANNEL_ID=your-channel-id
BRIDGE_HOST=windows-pc          # optional; defaults to os.hostname()
# BRIDGE_LEASE_STALE_MS=90000   # optional; no heartbeat → other machine may claim
# BRIDGE_FORCE=1                # steal on startup even if the other host is alive
```

Use the **same** `BRIDGE_LEASE_CHANNEL_ID` (and bot token) on every machine. On start, the bridge posts/edits a lease message there and heartbeats every 30s.

| Situation | What happens |
|---|---|
| Other host's heartbeat is stale (~90s) | This machine claims automatically |
| Other host is still alive | This machine stays **standby** (ignores prompts) |
| You want to switch now | `/bridge take` here, or start with `BRIDGE_FORCE=1` |
| Check who owns it | `/bridge status` |

Local `.bridge.lock` still blocks two `npm run dev` processes on the **same** machine.

---

## 9. Smoke test

1. In Discord, **DM the bot** (or use an allowlisted channel).
2. Type `/help`. Slash commands register on startup (guilds listed in `DISCORD_ALLOWED_GUILD_IDS` get them instantly).
3. Try `/ask prompt: what project am I on?` or just say `help`.
4. Say `switch to myapp` (or reply with its number). The bot opens that project's channel and sends you there — project work happens in that channel, so run `/prompt` once you're in it.

If slash commands don’t appear: re-invite with the `applications.commands` scope, or wait a minute and restart the bridge.

---

## Security notes (read once)

- **Trust boundary:** anyone in `DISCORD_ALLOWED_USER_IDS` can run Cursor Agent in every configured project. Runs pass `--trust` to the Cursor CLI, so treat the allowlist as "people you'd hand your laptop to". Keep it to yourself unless you mean otherwise.
- **Prompt privacy:** by default, run logs (`logs/*.jsonl`) and the console record prompt *length*, not text. Set `LOG_PROMPTS=true` only while debugging.
- **`/preview` is public:** the tunnel URL (`*.trycloudflare.com`) is reachable by anyone who has it while the tunnel is up. Use `/preview_stop` when done, and don't preview apps with sensitive data.
- **Attachments:** images/audio only, 25 MB cap, saved under `history/inbox/` with generated names.
- **Known dependency issue:** `npm audit` reports a critical `tar` advisory chain pulled in by `@discordjs/opus` (voice). No fixed release exists yet; it only matters when installing native voice binaries. Re-run `npm audit` after upgrades.

---

## Common “it doesn’t work” fixes

| Problem | Fix |
|---|---|
| Crashes on start: empty token / allowlist | Fill `DISCORD_BOT_TOKEN` and `DISCORD_ALLOWED_USER_IDS` in `.env.local` |
| Bot ignores you | Your user ID isn’t in the allowlist, or the channel isn’t in `DISCORD_ALLOWED_CHANNEL_IDS` |
| Bot ignores messages in a server | Enable **Message Content Intent** in the Developer Portal |
| No slash commands | Re-invite with `applications.commands`; set `DISCORD_ALLOWED_GUILD_IDS` for instant guild sync |
| Cursor never runs | Agent CLI missing; install it or set `CURSOR_BIN` to `agent.cmd` / `agent` |
| Discord reply is Electron “known options” warnings | `CURSOR_BIN` points at the IDE `cursor` shim; point it at `agent` / `cursor-agent` instead |
| Bot answers twice (Mac + PC) | Set `BRIDGE_LEASE_CHANNEL_ID` on both; only the lease owner handles prompts |
| Standby machine ignores prompts | Expected — `/bridge take` or `BRIDGE_FORCE=1` to switch |
| Attachment ignored | Supported: images, audio, PDF + plain text/markdown (max 25MB) |
| Voice notes fail | Set `OPENAI_API_KEY` |

---

## Useful commands

```bash
npm run dev       # run bridge (dev)
npm start         # run from build
npm test          # unit tests
npm run typecheck
npm run build
```

Optional extras (after the basic flow works):

- Voice assistant → see README “Voice assistant”
- Phone preview → install `cloudflared` (see the table above), then `/preview` in a project channel

Full feature reference: [README.md](../README.md).
