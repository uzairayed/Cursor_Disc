# Discord Voice Assistant - Spec (Phase 1)

Source of truth for acceptance tests. Scope: voice join/listen/speak + existing Cursor/commands.

## Acceptance criteria

1. **Join/leave:** Allowlisted user runs `/join` while in a guild VC → bot joins that channel and speaks a short greeting. `/leave` disconnects. Non-allowlisted users get ephemeral deny. `/voice_status` reports whether the bot is in a VC.
2. **Listen:** Bot records only allowlisted user’s speaking segments (VAD: speech start + ~800ms silence end). Idle silence is not sent to STT.
3. **Transcribe:** Each segment → OpenAI STT → text. Default realtime (`gpt-realtime-whisper`); falls back to batch `gpt-4o-mini-transcribe` on error (no tertiary `whisper-1` fallback). `VOICE_STT_MODE=batch` forces batch. Empty/noise transcripts ignored.
4. **Quick tools (no Cursor):**
   - “what’s the date/time” → local clock reply via TTS
   - “status” / “stop” / “stop all” / “help” / project switch phrases → reuse `handleUserMessage`
5. **Cursor path:** Other transcripts go through existing `MessageRouter.handle` (via `buildVoicePrompt`). Long agent output: speak a short status / 1–2 sentence summary; full text still posted to Discord text.
6. **Safety:** Voice session ignores other users in the channel.
7. **Config:** Discord Connect/Speak + `GuildVoiceStates` intent. Env: `OPENAI_API_KEY`, optional `VOICE_TTS_VOICE`, optional `VOICE_STT_MODE`.

## Out of scope

Wake word, email/calendar integrations, multi-user assistant, realtime streaming STT vendors, speaking full Cursor diffs aloud.
