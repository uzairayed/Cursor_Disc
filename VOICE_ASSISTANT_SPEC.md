# Discord Voice Assistant — Spec (Phase 1)

Source of truth for acceptance tests. Scope: voice join/listen/speak + existing Cursor/commands + Gmail read-only.

## Acceptance criteria

1. **Join/leave:** Allowlisted user runs `/join` while in a guild VC → bot joins that channel and speaks a short greeting. `/leave` disconnects. Non-allowlisted users get ephemeral deny. `/voice_status` reports whether the bot is in a VC.
2. **Listen:** Bot records only allowlisted user’s speaking segments (VAD: speech start + ~800ms silence end). Idle silence is not sent to STT.
3. **Transcribe:** Each segment → OpenAI STT (`gpt-4o-mini-transcribe`, fallback `whisper-1`) → text. Empty/noise transcripts ignored.
4. **Quick tools (no Cursor):**
   - “what’s the date/time” → local clock reply via TTS
   - “status” / “stop” / “stop all” / “help” / project switch phrases → reuse `handleUserMessage`
   - “check my email” / “any unread mail” / “summarize my inbox” → Gmail readonly → spoken summary (subject, from, date; max N messages, default 5)
5. **Cursor path:** Other transcripts go through existing `MessageRouter.handle` (via `buildVoicePrompt`). Long agent output: speak a short status / 1–2 sentence summary; full text still posted to Discord text.
6. **Gmail setup:** Desktop OAuth (`gmail.readonly`), tokens under `.secrets/gmail-token.json`. Missing credentials → “Gmail not connected; run setup”.
7. **Safety:** No send/delete/modify mail. Voice session ignores other users in the channel.
8. **Config:** Discord Connect/Speak + `GuildVoiceStates` intent. Env: `OPENAI_API_KEY`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, optional `VOICE_TTS_VOICE`.

## Out of scope

Wake word, mail send/archive, calendar, multi-user assistant, realtime streaming STT vendors, speaking full Cursor diffs aloud.
