import { Readable } from "node:stream";
import {
  containsInterruptIntent,
  type MessageRouter,
  parseProjectIntent,
  RealtimeSttSession,
  synthesizeSpeech,
  transcribeVoicePcm,
  VoiceSession,
} from "@cursor-bridge/core";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  EndBehaviorType,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  StreamType,
  type VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type {
  ChatInputCommandInteraction,
  Client,
  GuildMember,
  VoiceBasedChannel,
} from "discord.js";
import prism from "prism-media";
import type { DiscordConfig } from "../config.js";
import { captureRouterReply } from "./capture-reply.js";
import { stereoToMono } from "./pcm.js";

const SAMPLE_RATE = 48_000;
/**
 * Only bounds how long one Discord subscription stays open — turn endpointing
 * is now server-side VAD, so this no longer sits in the response path.
 */
const STREAM_END_MS = 700;

export class DiscordVoiceManager {
  private session: VoiceSession | null = null;
  private stt: RealtimeSttSession | null = null;
  private player = createAudioPlayer();
  private guildId: string | null = null;
  private channelId: string | null = null;
  private textChannelId: string | null = null;
  private speaking = new Set<string>();
  private lastSpeaker: string | null = null;
  /** Where voice prompts run; changed by a spoken "switch to <project>". */
  private projectKey = "general";
  /** Mic audio captured while TTS plays, scanned live for stop words. */
  private interruptProbe: Buffer[] = [];
  private probing = false;

  constructor(
    private readonly config: DiscordConfig,
    private readonly router: MessageRouter,
    private readonly client: Client,
  ) {}

  statusText(): string {
    if (!this.guildId || !this.channelId) {
      return "Not in a voice channel. Join a VC and run `/join`.";
    }
    return `In voice channel <#${this.channelId}> (guild ${this.guildId}), project **${this.projectKey.toUpperCase()}**. Listening for allowlisted users.`;
  }

  async join(interaction: ChatInputCommandInteraction): Promise<string> {
    if (!interaction.guild) {
      return "Voice only works in a server — join a voice channel there and run `/join`.";
    }
    const member = interaction.member as GuildMember | null;
    const channel = member?.voice?.channel as VoiceBasedChannel | null;
    if (!channel) {
      return "Join a voice channel first, then run `/join`.";
    }
    if (!this.config.openaiApiKey) {
      return "OPENAI_API_KEY isn't set — needed for speech-to-text and TTS.";
    }

    const existing = getVoiceConnection(interaction.guild.id);
    if (existing) existing.destroy();

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      connection.destroy();
      return "Couldn't connect to the voice channel in time. Try again.";
    }

    connection.subscribe(this.player);
    this.guildId = interaction.guild.id;
    this.channelId = channel.id;
    this.textChannelId = interaction.channelId;
    this.session = this.createSession(interaction.guild.id);
    await this.startStt();
    this.attachReceiver(connection);

    connection.on("stateChange", (_old, next) => {
      if (
        next.status === VoiceConnectionStatus.Disconnected ||
        next.status === VoiceConnectionStatus.Destroyed
      ) {
        this.clearSession();
      }
    });

    await this.session.say("Ready.");
    return [
      `Joined **${channel.name}**.`,
      "Tips: use **headphones** (avoids echo), pause ~1s after you finish talking, say **stop** to interrupt me.",
      "I'll post what I heard in this text channel.",
    ].join("\n");
  }

  async leave(): Promise<string> {
    if (!this.guildId) return "I'm not in a voice channel.";
    this.player.stop(true);
    const conn = getVoiceConnection(this.guildId);
    conn?.destroy();
    this.clearSession();
    return "Left the voice channel.";
  }

  private clearSession(): void {
    this.stt?.close();
    this.stt = null;
    this.session = null;
    this.guildId = null;
    this.channelId = null;
    this.textChannelId = null;
    this.speaking.clear();
    this.lastSpeaker = null;
    this.projectKey = "general";
    this.interruptProbe = [];
  }

  /**
   * Live barge-in while TTS plays. Transcripts can't drive this: with speakers,
   * the bot's echo keeps the server-VAD turn open for the whole reply, so no
   * transcript arrives until the bot has already finished talking. Instead the
   * raw mic capture is transcribed in ~1.2s windows and scanned for stop words.
   * ponytail: worst case ~2s to react (window fill + one-shot batch STT);
   * a streaming ASR with word timestamps would cut this but changes vendors.
   */
  private probeForStopWord(mono: Buffer): void {
    this.interruptProbe.push(mono);
    const bytes = this.interruptProbe.reduce((n, b) => n + b.byteLength, 0);
    if (bytes < SAMPLE_RATE * 2 * 1.2 || this.probing) return;
    const pcm = Buffer.concat(this.interruptProbe);
    this.interruptProbe = [];
    this.probing = true;
    void (async () => {
      try {
        const { text } = await transcribeVoicePcm({
          apiKey: this.config.openaiApiKey!,
          pcm,
          sampleRate: SAMPLE_RATE,
          // Batch: a cold realtime socket costs ~3s; HTTP one-shot is ~1s.
          mode: "batch",
        });
        if (containsInterruptIntent(text) && this.session?.getCaptureMode() === "interrupt") {
          console.log(`[voice] barge-in: ${text.slice(0, 60)}`);
          await this.session.bargeIn();
        }
      } catch {
        // Best-effort — the transcript path still handles clean-turn stops.
      } finally {
        this.probing = false;
      }
    })();
  }

  /**
   * Warm streaming transcription. If it can't connect we fall back to the
   * per-utterance path, which is slower but keeps voice working.
   */
  private async startStt(): Promise<void> {
    const stt = new RealtimeSttSession({
      apiKey: this.config.openaiApiKey!,
      onTranscript: (text) => {
        const session = this.session;
        const userId = this.lastSpeaker;
        if (!session || !userId) return;
        void session.ingestTranscript(userId, text).catch((err) => {
          console.error("[voice] transcript failed:", err);
        });
      },
      onError: (err) => {
        console.error("[voice] stt session:", err.message);
      },
    });
    try {
      await stt.connect();
      this.stt = stt;
      console.log("[voice] stt streaming (server vad)");
    } catch (err) {
      stt.close();
      this.stt = null;
      console.error("[voice] streaming stt unavailable, using per-utterance stt:", err);
    }
  }

  private async resolveTextChannel() {
    if (!this.textChannelId) return null;
    try {
      const ch = await this.client.channels.fetch(this.textChannelId);
      if (ch?.isTextBased()) return ch;
    } catch {
      // ignore
    }
    return null;
  }

  private createSession(guildId: string): VoiceSession {
    const apiKey = this.config.openaiApiKey!;
    const conversationKey = `discord:voice:${guildId}`;

    return new VoiceSession({
      allowedUserIds: this.config.discordAllowedUserIds,
      // Echo is filtered by transcript, so this only needs to cover the TTS tail.
      postSpeakMuteMs: 300,
      stopSpeaking: () => {
        this.player.stop(true);
      },
      speak: async (text) => {
        await this.speak(text);
      },
      onHeard: async (transcript) => {
        const textChannel = await this.resolveTextChannel();
        if (!textChannel?.isSendable()) return;
        await textChannel.send({
          content: `🎤 Heard: ${transcript.slice(0, 1800)}`,
        });
      },
      transcribe: async (pcm) => {
        const { text, via } = await transcribeVoicePcm({
          apiKey,
          pcm,
          sampleRate: SAMPLE_RATE,
          mode: this.config.voiceSttMode,
        });
        console.log(`[voice] stt via=${via}`);
        return text;
      },
      handleCommand: async (text) => {
        // Project navigation is a Discord-surface concern the router never sees
        // (text channels handle it in client.ts), so voice intercepts it here.
        const nav = parseProjectIntent(text, this.router.projects, { allowNumber: true });
        if (nav?.action === "select") {
          this.projectKey = nav.key;
          return `Switched to ${nav.key}.`;
        }
        const textChannel = await this.resolveTextChannel();
        return captureRouterReply({
          router: this.router,
          text,
          conversationKey,
          textChannel,
          projectKey: this.projectKey,
        });
      },
      handleAgent: async (text, signal) => {
        if (signal?.aborted) return null;
        const textChannel = await this.resolveTextChannel();
        // Cursor CLI isn't abortable mid-run yet; signal stops follow-up TTS.
        const reply = await captureRouterReply({
          router: this.router,
          text,
          conversationKey,
          asVoiceNote: true,
          textChannel,
          projectKey: this.projectKey,
        });
        if (signal?.aborted) return null;
        return reply;
      },
    });
  }

  private attachReceiver(connection: VoiceConnection): void {
    const receiver = connection.receiver;
    receiver.speaking.on("start", (userId) => {
      if (this.speaking.has(userId)) return;
      if (!this.config.discordAllowedUserIds.includes(userId)) return;
      const mode = this.session?.getCaptureMode() ?? "closed";
      // Half-duplex: ignore audio while closed; allow stop-words during TTS.
      if (mode === "closed") return;
      this.speaking.add(userId);
      this.lastSpeaker = userId;

      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: STREAM_END_MS },
      });

      const decoder = new prism.opus.Decoder({
        rate: SAMPLE_RATE,
        channels: 2,
        frameSize: 960,
      });

      const streaming = this.stt;
      const chunks: Buffer[] = [];
      let finished = false;
      opusStream.pipe(decoder);
      decoder.on("data", (chunk: Buffer) => {
        // Re-check per frame: the mode can close mid-subscription, and streaming
        // audio while closed would bill for speech we intend to discard.
        const mode = this.session?.getCaptureMode();
        if (mode === "closed" || mode == null) return;
        const mono = stereoToMono(chunk);
        if (mode === "interrupt") this.probeForStopWord(mono);
        else this.interruptProbe = [];
        if (streaming) streaming.pushPcm(mono, SAMPLE_RATE);
        else chunks.push(mono);
      });

      const finish = () => {
        if (finished) return;
        finished = true;
        this.speaking.delete(userId);
        // Streaming path already forwarded audio; the server ends the turn.
        if (streaming) return;
        const pcm = Buffer.concat(chunks);
        const session = this.session;
        if (!session) return;
        const capture = session.getCaptureMode();
        if (capture === "closed") return;
        if (pcm.byteLength < SAMPLE_RATE * 0.35 * 2) return;
        void session.ingestUtterance(userId, pcm).catch((err) => {
          console.error("[voice] utterance failed:", err);
        });
      };

      opusStream.once("end", finish);
      opusStream.once("close", finish);
      opusStream.once("error", (err) => {
        console.error("[voice] opus stream error:", err);
        finish();
      });
    });
  }

  private async speak(text: string): Promise<void> {
    if (!this.config.openaiApiKey) return;
    // Stop any prior clip so chunked TTS / interrupts don't overlap.
    this.player.stop(true);
    try {
      // Audio streams straight from OpenAI into ffmpeg, so playback starts on the
      // first chunk. createAudioResource also throws synchronously when ffmpeg is
      // missing, so it has to sit inside the guard or a missing ffmpeg fails /join.
      const audio = await synthesizeSpeech({
        apiKey: this.config.openaiApiKey,
        text,
        voice: this.config.voiceTtsVoice,
        speed: this.config.voiceTtsSpeed,
      });
      const resource = createAudioResource(audio, { inputType: StreamType.Arbitrary });
      this.player.play(resource);
      await entersState(this.player, AudioPlayerStatus.Playing, 5_000);
      await entersState(this.player, AudioPlayerStatus.Idle, 120_000);
    } catch (err) {
      // AbortError is expected when stopSpeaking() interrupts playback.
      if (err instanceof Error && /abort|ABORT/i.test(err.name + err.message)) return;
      console.error("[voice] speak failed (is ffmpeg installed?):", err);
    }
  }
}

let manager: DiscordVoiceManager | null = null;

export function getOrCreateVoiceManager(
  config: DiscordConfig,
  router: MessageRouter,
  client: Client,
): DiscordVoiceManager {
  if (!manager) manager = new DiscordVoiceManager(config, router, client);
  return manager;
}

export function resetVoiceManagerForTests(): void {
  manager = null;
}
