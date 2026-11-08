import http from "node:http";
import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import { log } from "../util/log.js";
import { decodePayload, encodePayload } from "./stream.js";

/**
 * One live Twilio media stream (a single call leg).
 *
 * A `MediaSession` wraps the WebSocket Twilio connects to and translates its
 * JSON protocol into simple events and methods. The agent loop is the only
 * consumer: it feeds inbound audio to speech-to-text and pushes synthesized
 * audio back with {@link sendAudio}.
 *
 * Twilio's message protocol is documented at
 * https://www.twilio.com/docs/voice/media-streams/websocket-messages
 */

export interface TwilioStartInfo {
  streamSid: string;
  callSid?: string;
  accountSid?: string;
}

export declare interface MediaSession {
  on(event: "start", listener: (info: TwilioStartInfo) => void): this;
  on(event: "media", listener: (payload: Buffer, track: string) => void): this;
  on(event: "stop", listener: () => void): this;
  on(event: "close", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class MediaSession extends EventEmitter {
  streamSid?: string;
  callSid?: string;

  constructor(private readonly ws: WebSocket) {
    super();
    ws.on("message", (data) => this.handleMessage(data));
    ws.on("close", () => this.emit("close"));
    ws.on("error", (err) => this.emit("error", err));
  }

  private handleMessage(data: RawData): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      return; // ignore malformed frames
    }

    switch (message.event) {
      case "start": {
        const start = (message.start ?? {}) as Record<string, unknown>;
        this.streamSid = message.streamSid as string;
        this.callSid = start.callSid as string | undefined;
        this.emit("start", {
          streamSid: this.streamSid,
          callSid: this.callSid,
          accountSid: start.accountSid as string | undefined,
        } satisfies TwilioStartInfo);
        break;
      }
      case "media": {
        const media = (message.media ?? {}) as Record<string, unknown>;
        const payload = media.payload as string | undefined;
        if (payload) {
          this.emit("media", decodePayload(payload), (media.track as string) ?? "inbound");
        }
        break;
      }
      case "stop":
        this.emit("stop");
        break;
      case "connected":
      case "mark":
        // Bookkeeping messages we deliberately ignore at this layer.
        break;
      default:
        break;
    }
  }

  /** Send synthesized audio back to the callee. */
  sendAudio(buf: Buffer): void {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;
    const message = { event: "media", streamSid: this.streamSid, media: { payload: encodePayload(buf) } };
    this.ws.send(JSON.stringify(message));
  }

  /** Tell Twilio to drop any buffered audio we have sent (used on barge-in). */
  clear(): void {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
  }

  /** Send a marker that Twilio will echo back once playback reaches it. */
  sendMark(name: string): void {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name } }));
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * The local HTTP + WebSocket server Twilio connects to.
 *
 * It serves a trivial `/health` endpoint and upgrades `/media` WebSocket
 * connections into {@link MediaSession}s. The server is started fresh for each
 * call and supports a single concurrent stream (v1 scope).
 */
export class MediaServer extends EventEmitter {
  private server?: http.Server;
  private wss?: WebSocketServer;
  private hasSession = false;

  /** Binds to `port` (use 0 for an ephemeral port) and resolves the bound port. */
  start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.url === "/health") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      });

      this.wss = new WebSocketServer({ server: this.server, path: "/media" });
      this.wss.on("connection", (ws) => this.onConnection(ws));
      this.wss.on("error", (err) => reject(err));

      this.server.once("error", (err) => reject(err));
      this.server.listen(port, () => {
        const address = this.server?.address();
        const boundPort = typeof address === "object" && address ? address.port : port;
        resolve(boundPort);
      });
    });
  }

  private onConnection(ws: WebSocket): void {
    if (this.hasSession) {
      log.warn("Rejecting second media-stream connection (single-call scope)");
      ws.close();
      return;
    }
    this.hasSession = true;
    const session = new MediaSession(ws);
    session.on("close", () => {
      this.hasSession = false;
    });
    log.info("Media stream connected");
    this.emit("session", session);
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const closeServer = (): void => {
        if (this.server?.listening) {
          this.server.close(() => resolve());
        } else {
          resolve();
        }
      };
      if (this.wss) {
        for (const client of this.wss.clients) client.close();
        this.wss.close(() => closeServer());
      } else {
        closeServer();
      }
    });
  }
}
