import type { MediaSession } from "../media/server.js";
import { CHUNK_MS, MULAW_BYTES_PER_CHUNK } from "../media/stream.js";
import type { SttProvider } from "../speech/stt.js";
import type { TtsProvider } from "../speech/tts.js";
import type { ChatMessage, LlmProvider } from "../llm/index.js";
import type { Transcript } from "./transcript.js";
import { log } from "../util/log.js";

/**
 * The conversation state machine.
 *
 * One `AgentLoop` drives a single call:
 *
 *   idle → greeting → listening ⇄ thinking → speaking → (ended)
 *
 * Speech-to-text runs continuously for the whole call so the callee can
 * interrupt (barge-in) the agent mid-sentence. A monotonically increasing
 * `generation` token discards stale playback once a newer turn supersedes it.
 */

export interface AgentLoopOptions {
  greeting: string;
  systemPrompt: string;
  maxTurns: number;
  silenceTimeoutMs: number;
  stt: SttProvider;
  tts: TtsProvider;
  llm: LlmProvider;
  transcript: Transcript;
}

type AgentState = "idle" | "listening" | "thinking" | "speaking" | "ended";

export class AgentLoop {
  private state: AgentState = "idle";
  private session?: MediaSession;
  private currentUtterance = "";
  private turns = 0;
  private silenceCount = 0;
  private generation = 0;
  private stopPlayback = false;
  private silenceTimer?: NodeJS.Timeout;
  private endReason?: string;
  private endResolver?: (reason: string) => void;
  private readonly history: Array<{ role: "user" | "assistant"; content: string }> = [];

  constructor(private readonly options: AgentLoopOptions) {}

  /** Wire a live media session into the loop and start transcription. */
  start(session: MediaSession): void {
    this.session = session;

    void this.options.stt.start({
      onInterimTranscript: (text) => this.onInterim(text),
      onFinalTranscript: (text) => this.onFinal(text),
      onUtteranceEnd: () => this.onUtteranceEnd(),
      onError: (err) => log.warn("Speech-to-text error: " + err.message),
    });

    session.on("start", () => {
      void this.begin();
    });
    session.on("media", (payload, track) => {
      // Only the callee's audio goes to speech-to-text; our own TTS is echoed
      // back on the "outbound" track and must be ignored.
      if (track === "inbound") this.options.stt.sendAudio(payload);
    });
    session.on("stop", () => {
      void this.end("Twilio ended the call");
    });
    session.on("close", () => {
      void this.end("Media stream closed");
    });
    session.on("error", (err) => log.warn("Media stream error: " + err.message));
  }

  /** Resolves once the call has ended, with a human-readable reason. */
  waitForEnd(): Promise<string> {
    if (this.endReason) return Promise.resolve(this.endReason);
    return new Promise((resolve) => {
      this.endResolver = resolve;
    });
  }

  private async begin(): Promise<void> {
    if (this.state !== "idle") return;
    log.info("Call connected — greeting the callee");
    this.options.transcript.add("system", "call started");
    await this.speak(this.options.greeting);
  }

  private onInterim(_text: string): void {
    this.resetSilenceTimer();
    if (this.state === "speaking") {
      this.stopPlayback = true;
      this.session?.clear();
      log.info("Barge-in detected — pausing playback");
    }
  }

  private onFinal(text: string): void {
    this.currentUtterance = this.currentUtterance
      ? `${this.currentUtterance} ${text}`
      : text;
  }

  private onUtteranceEnd(): void {
    if (this.state === "listening" || this.state === "speaking") {
      void this.think();
    }
  }

  private async think(): Promise<void> {
    if (this.state === "ended" || this.state === "thinking") return;

    const utterance = this.currentUtterance.trim();
    this.currentUtterance = "";
    this.clearSilenceTimer();
    this.stopPlayback = true;
    this.session?.clear();

    if (!utterance) {
      this.silenceCount += 1;
      log.info(`Silence detected (${this.silenceCount}/2)`);
      if (this.silenceCount >= 2) {
        await this.end("No speech detected twice");
        return;
      }
      await this.speak("Sorry, I didn't catch that. Could you please repeat that?");
      return;
    }

    this.silenceCount = 0;
    this.options.transcript.add("caller", utterance);
    this.history.push({ role: "user", content: utterance });

    this.turns += 1;
    if (this.turns > this.options.maxTurns) {
      await this.end("Maximum turns reached");
      return;
    }

    this.state = "thinking";
    log.info("Thinking...");
    let reply: string;
    try {
      reply = await this.options.llm.complete(this.buildMessages());
    } catch (err) {
      log.error("LLM error: " + (err as Error).message);
      await this.end("LLM error");
      return;
    }
    if (this.isEnded()) return;
    await this.speak(reply);
  }

  private buildMessages(): ChatMessage[] {
    return [
      { role: "system", content: this.options.systemPrompt },
      ...this.history.map((h) => ({ role: h.role, content: h.content })),
    ];
  }

  private async speak(text: string): Promise<void> {
    if (this.state === "ended") return;
    this.state = "speaking";
    this.options.transcript.add("assistant", text);
    this.history.push({ role: "assistant", content: text });

    const generation = ++this.generation;
    this.stopPlayback = false;

    let audio: Buffer;
    try {
      audio = await this.options.tts.synthesize(text);
    } catch (err) {
      log.error("Text-to-speech error: " + (err as Error).message);
      await this.end("Text-to-speech error");
      return;
    }
    if (this.isEnded() || this.generation !== generation) return;

    await this.playAudio(audio, generation);
    if (this.isEnded() || this.generation !== generation) return;
    await this.enterListening();
  }

  /** Streams µ-law audio to Twilio in 20 ms frames, bailing on interruption. */
  private async playAudio(buf: Buffer, generation: number): Promise<void> {
    await new Promise<void>((resolve) => {
      let offset = 0;
      const timer = setInterval(() => {
        if (this.stopPlayback || this.state === "ended" || this.generation !== generation) {
          clearInterval(timer);
          resolve();
          return;
        }
        const end = Math.min(offset + MULAW_BYTES_PER_CHUNK, buf.length);
        this.session?.sendAudio(buf.subarray(offset, end));
        offset = end;
        if (offset >= buf.length) {
          clearInterval(timer);
          resolve();
        }
      }, CHUNK_MS);
    });
  }

  private async enterListening(): Promise<void> {
    if (this.state === "ended") return;
    this.state = "listening";
    this.currentUtterance = "";
    this.resetSilenceTimer();
    log.info("Listening...");
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.state === "listening") void this.think();
    }, this.options.silenceTimeoutMs);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
  }

  /**
   * Reading state through a method prevents TypeScript from over-narrowing the
   * mutable `this.state` across `await` — the state can be changed asynchronously
   * by `end()` (from a media event) while another turn is mid-flight.
   */
  private isEnded(): boolean {
    return this.state === "ended";
  }

  private async end(reason: string): Promise<void> {
    if (this.state === "ended") return;
    this.state = "ended";
    this.clearSilenceTimer();
    this.endReason = reason;
    this.options.transcript.add("system", "call ended: " + reason);
    log.info("Call ended: " + reason);
    this.options.stt.close();
    this.session?.close();
    this.endResolver?.(reason);
  }
}
