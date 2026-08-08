import {
  VoiceSession,
  createGmailTransport,
  loadGmailConfigFromEnv,
  synthesizeSpeech,
  transcribeVoicePcm,
  type MessageRouter,
} from "@cursor-bridge/core";
import {
  AudioPlayerStatus,
  EndBehaviorType,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type VoiceConnection,
} from "@discordjs/voice";
import type {
  ChatInputCommandInteraction,
  Client,
  GuildMember,
  VoiceBasedChannel,
} from "discord.js";
import { Readable } from "node:stream";
import prism from "prism-media";
import type { DiscordConfig } from "../config.js";
import { captureRouterReply } from "./capture-reply.js";
import { stereoToMono } from "./pcm.js";

const SAMPLE_RATE = 48_000;

export class DiscordVoiceManager {
  private session: VoiceSession | null = null;
  private player = createAudioPlayer();
  private guildId: string | null = null;
  private channelId: string | null = null;
  private textChannelId: string | null = null;
  private speaking = new Set<string>();

  constructor(
    private readonly config: DiscordConfig,
    private readonly router: MessageRouter,
    private readonly client: Client
  ) {}

  statusText(): string {
    if (!this.guildId || !this.channelId) {
      return "Not in a voice channel. Join a VC and run `/join`.";
    }
    return `In voice channel <#${this.channelId}> (guild ${this.guildId}). Listening for allowlisted users.`;
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
    this.attachReceiver(connection);
    this.session = this.createSession(interaction.guild.id);

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
    this.session = null;
    this.guildId = null;
    this.channelId = null;
    this.textChannelId = null;
    this.speaking.clear();
  }

  private async resolveTextChannel() {
    if (!this.textChannelId) return null;
    try {
      const ch = await this.client.channels.fetch(this.textChannelId);
      if (ch && ch.isTextBased()) return ch;
    } catch {
      // ignore
    }
    return null;
  }

  private createSession(guildId: string): VoiceSession {
    const apiKey = this.config.openaiApiKey!;
    const gmailCfg = loadGmailConfigFromEnv(process.env, this.config.rootDir);
    const gmail = gmailCfg ? createGmailTransport(gmailCfg) : null;
    const conversationKey = `discord:voice:${guildId}`;

    return new VoiceSession({
      allowedUserIds: this.config.discordAllowedUserIds,
      gmail,
      stopSpeaking: () => {
        this.player.stop(true);
      },
      speak: async (text) => {
        await this.speak(text);
      },
      onHeard: async (transcript) => {
        const textChannel = await this.resolveTextChannel();
        if (!textChannel || !textChannel.isSendable()) return;
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
        const textChannel = await this.resolveTextChannel();
        return captureRouterReply({
          router: this.router,
          text,
          conversationKey,
          textChannel,
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

      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          // ~1.1s silence end — snappier than 1.8s; coalesce still merges mid-thought cuts.
          duration: 1100,
        },
      });

      const decoder = new prism.opus.Decoder({
        rate: SAMPLE_RATE,
        channels: 2,
        frameSize: 960,
      });

      const chunks: Buffer[] = [];
      let finished = false;
      opusStream.pipe(decoder);
      decoder.on("data", (chunk: Buffer) => {
        chunks.push(stereoToMono(chunk));
      });

      const finish = () => {
        if (finished) return;
        finished = true;
        this.speaking.delete(userId);
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
    const audio = await synthesizeSpeech({
      apiKey: this.config.openaiApiKey,
      text,
      voice: this.config.voiceTtsVoice,
    });
    const resource = createAudioResource(Readable.from(audio), {
      inputType: StreamType.Arbitrary,
    });
    this.player.play(resource);
    try {
      await entersState(this.player, AudioPlayerStatus.Playing, 5_000);
      await entersState(this.player, AudioPlayerStatus.Idle, 120_000);
    } catch (err) {
      // AbortError is expected when stopSpeaking() interrupts playback.
      if (err instanceof Error && /abort|ABORT/i.test(err.name + err.message)) return;
      console.error("[voice] playback error (is ffmpeg installed?):", err);
    }
  }
}

let manager: DiscordVoiceManager | null = null;

export function getOrCreateVoiceManager(
  config: DiscordConfig,
  router: MessageRouter,
  client: Client
): DiscordVoiceManager {
  if (!manager) manager = new DiscordVoiceManager(config, router, client);
  return manager;
}

export function resetVoiceManagerForTests(): void {
  manager = null;
}
