# Local setup guide

Run the Discord → Cursor bridge on your Mac in about 15 minutes.

## What you need

- A Mac
- [Node.js 20+](https://nodejs.org/) (`node -v` should show `v20` or higher)
- [Cursor](https://cursor.com) desktop app, with the Agent CLI available as `cursor` on your PATH
- A Discord account

Optional later (skip for first run):

- `OPENAI_API_KEY`: voice notes + voice assistant
- `ffmpeg` (`brew install ffmpeg`): voice TTS playback
- `cloudflared` (`brew install cloudflared`): `/preview` tunnels

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

Example shape:

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

## 6. Confirm Cursor CLI works

```bash
cursor --version
```

If that fails, open Cursor → install/enable the shell command, or set an absolute path:

```env
CURSOR_BIN=/full/path/to/cursor
```

The bridge shells out to this binary to run Agent.

---

## 7. Start the bridge

```bash
npm run dev
```

You should see the Discord client come online (no crash about missing token / allowlist).

Leave this terminal open while you use it.

---

## 8. Smoke test

1. In Discord, **DM the bot** (or use an allowlisted channel).
2. Type `/help`. Slash commands register on startup (guilds listed in `DISCORD_ALLOWED_GUILD_IDS` get them instantly).
3. Try `/ask prompt: what project am I on?` or just say `help`.
4. Pick a project (`1`, or `switch to myapp`), then send a real prompt with `/prompt`.

If slash commands don’t appear: re-invite with the `applications.commands` scope, or wait a minute and restart the bridge.

---

## Common “it doesn’t work” fixes

| Problem | Fix |
|---|---|
| Crashes on start: empty token / allowlist | Fill `DISCORD_BOT_TOKEN` and `DISCORD_ALLOWED_USER_IDS` in `.env.local` |
| Bot ignores you | Your user ID isn’t in the allowlist, or the channel isn’t in `DISCORD_ALLOWED_CHANNEL_IDS` |
| Bot ignores messages in a server | Enable **Message Content Intent** in the Developer Portal |
| No slash commands | Re-invite with `applications.commands`; set `DISCORD_ALLOWED_GUILD_IDS` for instant guild sync |
| Cursor never runs | `cursor` not on PATH; fix PATH or set `CURSOR_BIN` |
| Images work, PDFs don’t | Only images + audio are supported as attachments (max 25MB) |
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
- Phone preview → `brew install cloudflared`, then `/preview` in a project channel

Full feature reference: [README.md](./README.md).
