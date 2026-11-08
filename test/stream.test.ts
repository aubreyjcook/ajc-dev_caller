import { describe, expect, it } from "vitest";
import {
  chunkAudio,
  decodePayload,
  encodePayload,
  MULAW_BYTES_PER_CHUNK,
} from "../src/media/stream.js";

describe("media/stream", () => {
  it("round-trips a buffer through base64 payload encoding", () => {
    const input = Buffer.from([0, 1, 2, 127, 128, 254, 255]);
    expect(decodePayload(encodePayload(input))).toEqual(input);
  });

  it("splits audio into 20 ms (160-byte) chunks", () => {
    const buf = Buffer.alloc(400, 0x55);
    const chunks = chunkAudio(buf);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(MULAW_BYTES_PER_CHUNK);
    expect(chunks[2]).toHaveLength(80);
  });
});
