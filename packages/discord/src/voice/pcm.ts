/** Downmix interleaved stereo s16le PCM to mono. */
export function stereoToMono(stereo: Buffer): Buffer {
  const frames = Math.floor(stereo.byteLength / 4);
  const mono = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const l = stereo.readInt16LE(i * 4);
    const r = stereo.readInt16LE(i * 4 + 2);
    mono.writeInt16LE((l + r) >> 1, i * 2);
  }
  return mono;
}
