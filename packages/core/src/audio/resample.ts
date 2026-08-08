/** Downsample 16-bit mono PCM by an integer factor (e.g. 48kHz → 24kHz with factor 2). */
export function downsamplePcmMonoS16le(pcm: Buffer, factor: number): Buffer {
  if (factor <= 1) return pcm;
  const inSamples = Math.floor(pcm.byteLength / 2);
  const outSamples = Math.floor(inSamples / factor);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    out.writeInt16LE(pcm.readInt16LE(i * factor * 2), i * 2);
  }
  return out;
}
