export interface VadOptions {
  sampleRate?: number;
  /** Frame size in milliseconds (default 20). */
  frameMs?: number;
  /** Silence duration that ends an utterance (default 800). */
  silenceMs?: number;
  /** Minimum speech duration to keep (default 200). */
  minSpeechMs?: number;
  /** RMS energy threshold 0..1 (default 0.015). */
  energyThreshold?: number;
}

/**
 * Energy-based VAD for 16-bit mono PCM. Push frames; returns a complete
 * utterance Buffer when speech ends after `silenceMs` of quiet.
 */
export class VadSegmenter {
  private readonly sampleRate: number;
  private readonly frameMs: number;
  private readonly silenceFrames: number;
  private readonly minSpeechFrames: number;
  private readonly energyThreshold: number;

  private speaking = false;
  private speechFrames = 0;
  private silenceCount = 0;
  private chunks: Buffer[] = [];

  constructor(opts: VadOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 48_000;
    this.frameMs = opts.frameMs ?? 20;
    const silenceMs = opts.silenceMs ?? 800;
    const minSpeechMs = opts.minSpeechMs ?? 200;
    this.silenceFrames = Math.max(1, Math.round(silenceMs / this.frameMs));
    this.minSpeechFrames = Math.max(1, Math.round(minSpeechMs / this.frameMs));
    this.energyThreshold = opts.energyThreshold ?? 0.015;
  }

  push(pcmFrame: Buffer): Buffer | null {
    const loud = rmsEnergy(pcmFrame) >= this.energyThreshold;

    if (loud) {
      if (!this.speaking) {
        this.speaking = true;
        this.speechFrames = 0;
        this.chunks = [];
      }
      this.speechFrames += 1;
      this.silenceCount = 0;
      this.chunks.push(pcmFrame);
      return null;
    }

    if (!this.speaking) return null;

    this.chunks.push(pcmFrame);
    this.silenceCount += 1;

    if (this.silenceCount < this.silenceFrames) return null;

    const keep = this.speechFrames >= this.minSpeechFrames;
    const segment = keep ? Buffer.concat(this.chunks) : null;
    this.reset();
    return segment;
  }

  flush(): Buffer | null {
    if (!this.speaking) return null;
    const keep = this.speechFrames >= this.minSpeechFrames;
    const segment = keep ? Buffer.concat(this.chunks) : null;
    this.reset();
    return segment;
  }

  private reset(): void {
    this.speaking = false;
    this.speechFrames = 0;
    this.silenceCount = 0;
    this.chunks = [];
  }
}

function rmsEnergy(pcm: Buffer): number {
  if (pcm.byteLength < 2) return 0;
  const samples = Math.floor(pcm.byteLength / 2);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = pcm.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}
