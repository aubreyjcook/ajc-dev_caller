import { WebSocket } from "ws";
import type { SttCallbacks, SttProvider } from "../stt.js";

/**
 * Deepgram streaming speech-to-text over raw WebSocket.
 *
 * We talk to Deepgram directly instead of using the v5 SDK, whose API changed
 * substantially. The wire protocol is small and stable:
 *   - `wss://api.deepgram.com/v1/listen` with query params selecting the model
 *     and audio format.
 *   - `Authorization: Token <apiKey>` header.
 *   - Binary frames carry raw µ-law audio; text frames carry JSON results.
 *
 * See https://developers.deepgram.com/docs/streaming-audio
 */
export class DeepgramSttProvider implements SttProvider {
  private ws?: WebSocket;
  private opened = false;
  private readonly pending: Buffer[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async start(callbacks: SttCallbacks): Promise<void> {
    const params = new URLSearchParams({
      model: this.model,
      encoding: "mulaw",
      sample_rate: "8000",
      channels: "1",
      interim_results: "true",
      endpointing: "true",
      smart_format: "true",
    });
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    const ws = new WebSocket(url, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });
    this.ws = ws;

    ws.on("open", () => {
      this.opened = true;
      for (const chunk of this.pending.splice(0)) ws.send(chunk);
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      this.handleMessage(data.toString(), callbacks);
    });
    ws.on("error", (err) => callbacks.onError(err));
    ws.on("close", () => {
      this.opened = false;
    });
  }

  private handleMessage(raw: string, callbacks: SttCallbacks): void {
    let message: {
      type?: string;
      is_final?: boolean;
      speech_final?: boolean;
      channel?: { alternatives?: Array<{ transcript?: string }> };
    };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }

    if (message.type !== "Results") return;

    const text = message.channel?.alternatives?.[0]?.transcript ?? "";
    if (text.trim()) {
      callbacks.onInterimTranscript(text);
      if (message.is_final) callbacks.onFinalTranscript(text);
    }
    if (message.speech_final) callbacks.onUtteranceEnd();
  }

  sendAudio(chunk: Buffer): void {
    if (this.opened && this.ws) {
      this.ws.send(chunk);
    } else if (this.pending.length < 256) {
      // Buffer a small amount while the socket opens.
      this.pending.push(chunk);
    }
  }

  close(): void {
    try {
      this.ws?.send(JSON.stringify({ type: "CloseStream" }));
    } catch {
      // Ignore — the socket may already be closed.
    }
    this.ws?.close();
  }
}
