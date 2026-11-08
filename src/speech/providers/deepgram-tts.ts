import type { TtsProvider } from "../tts.js";

/**
 * Deepgram Aura text-to-speech over the REST `speak` endpoint.
 *
 * Requesting `encoding=mulaw&sample_rate=8000&container=none` returns raw
 * µ-law/8 kHz audio in the response body, which matches Twilio Media Streams
 * exactly — no resampling required.
 *
 * See https://developers.deepgram.com/docs/text-to-speech
 */
export class DeepgramTtsProvider implements TtsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly voice: string,
  ) {}

  async synthesize(text: string): Promise<Buffer> {
    const params = new URLSearchParams({
      model: `aura-${this.voice}-en`,
      encoding: "mulaw",
      sample_rate: "8000",
      container: "none",
    });
    const url = `https://api.deepgram.com/v1/speak?${params.toString()}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Deepgram TTS failed (${response.status}): ${body}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
