# Cursor Discord Bridge

Run [Cursor Agent](https://cursor.com) from Discord. The bridge stays on your computer; Discord is just the remote control.

Works in DMs, server channels, and threads. Node 20+ on macOS, Linux, or Windows.

Full install walkthrough: [SETUP.md](./SETUP.md).

## Quick start

1. Create a Discord bot, turn on **Message Content Intent**, invite it with `bot` + `applications.commands`.
2. Put your bot token and Discord user ID in `.env.local`.
3. Point `projects.json` at the folders you care about.

```bash
npm install
cp .env.example .env.local
cp projects.example.json projects.json
# edit .env.local and projects.json
npm run dev
```

Then DM the bot `/help`.

## Day to day

Prefer slash commands: `/prompt` to edit, `/ask` for read-only Q&A, `/project` to switch folders, `/stop` / `/status` when a run is going.

In a server channel, `@mention` the bot (or use `/prompt`). In DMs and threads, just type.

Each channel message usually opens a thread; keep talking there to continue the same Cursor chat. DMs are one long conversation.

**General vs project:** DMs and `#general` use the local `general/` folder for open-ended questions. Say `switch to myapp` and the bot opens `#myapp` for that codebase. Project work stays in that project channel.

Large prompts get held first; reply `plan` or `run`. Images and voice notes work if `OPENAI_API_KEY` is set.

Only allowlisted users (and channels, if you set them) can talk to the bot. Details in SETUP.

## Optional extras

**Voice:** join a voice channel, then `/join`. Needs `OPENAI_API_KEY` and `ffmpeg` on your PATH. Use headphones; say `stop` to interrupt. Spec: [VOICE_ASSISTANT_SPEC.md](./VOICE_ASSISTANT_SPEC.md).

**Preview:** `/preview` tunnels a local dev server with Cloudflare so you can open it on your phone. Needs `cloudflared` on PATH. `/preview_pick` adds an element picker. `/preview_stop` tears it down.

## Layout

| Package | What it is |
| --- | --- |
| `@cursor-bridge/core` | Router, queue, Cursor runner |
| `@cursor-bridge/discord` | Discord bot entrypoint |

## Scripts

```bash
npm run dev        # start the bridge
npm test
npm run build
npm start          # run compiled output
```

History lives under `history/`. Logs under `logs/`. Leave the process running while you use it; sleep or quit kills preview tunnels.
