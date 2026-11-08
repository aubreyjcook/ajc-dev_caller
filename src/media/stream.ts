/**
 * Twilio Media Streams audio constants and payload helpers.
 *
 * Twilio streams audio as µ-law (G.711 PCMU), 8 kHz, mono, base64-encoded
 * inside JSON messages. 8 kHz × 1 byte/sample means a 20 ms frame is exactly
 * 160 bytes — a convenient pacing unit when we play synthesized audio back.
 */

export const MULAW_SAMPLE_RATE = 8000;
export const CHUNK_MS = 20;
export const MULAW_BYTES_PER_CHUNK = (MULAW_SAMPLE_RATE / 1000) * CHUNK_MS; // 160

/** Decode a base64 media payload from Twilio into raw µ-law bytes. */
export function decodePayload(payload: string): Buffer {
  return Buffer.from(payload, "base64");
}

/** Encode raw µ-law bytes into the base64 payload Twilio expects. */
export function encodePayload(buf: Buffer): string {
  return buf.toString("base64");
}

/** Split a µ-law buffer into fixed 20 ms frames for paced playback. */
export function chunkAudio(buf: Buffer, chunkSize = MULAW_BYTES_PER_CHUNK): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buf.length; offset += chunkSize) {
    chunks.push(buf.subarray(offset, offset + chunkSize));
  }
  return chunks;
}
