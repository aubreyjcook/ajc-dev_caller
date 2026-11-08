import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentLoop } from "../src/agent/loop.js";
import { Transcript } from "../src/agent/transcript.js";
import type { MediaSession } from "../src/media/server.js";
import type { SttCallbacks, SttProvider } from "../src/speech/stt.js";
import type { TtsProvider } from "../src/speech/tts.js";
import type { ChatMessage, LlmProvider } from "../src/llm/index.js";

/** Minimal stand-in for the media session: an EventEmitter with stub methods. */
class FakeSession extends EventEmitter {
  sent: Buffer[] = [];
  cleared = 0;
  closed = false;
  sendAudio(buf: Buffer): void {
    this.sent.push(buf);
  }
  clear(): void {
    this.cleared += 1;
  }
  close(): void {
    this.closed = true;
  }
}

class FakeStt implements SttProvider {
  callbacks?: SttCallbacks;
  closed = false;
  async start(callbacks: SttCallbacks): Promise<void> {
    this.callbacks = callbacks;
  }
  sendAudio(_chunk: Buffer): void {
    // no-op
  }
  close(): void {
    this.closed = true;
  }
}

class FakeTts implements TtsProvider {
  async synthesize(_text: string): Promise<Buffer> {
    return Buffer.alloc(160); // one 20 ms µ-law chunk
  }
}

class FakeLlm implements LlmProvider {
  async complete(_messages: ChatMessage[]): Promise<string> {
    return "This is a reply.";
  }
}

describe("AgentLoop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("greets, transcribes the caller, and speaks an LLM reply", async () => {
    vi.useFakeTimers();

    const transcript = new Transcript();
    const stt = new FakeStt();
    const loop = new AgentLoop({
      greeting: "Hello there",
      systemPrompt: "system",
      maxTurns: 5,
      silenceTimeoutMs: 1500,
      stt,
      tts: new FakeTts(),
      llm: new FakeLlm(),
      transcript,
    });

    const session = new FakeSession();
    loop.start(session as unknown as MediaSession);

    // Twilio signals the stream started.
    session.emit("start");
    expect(transcript.all().some((e) => e.speaker === "assistant" && e.text === "Hello there")).toBe(true);

    // Let greeting TTS finish playing (one 20 ms chunk).
    await vi.advanceTimersByTimeAsync(20);

    // The callee speaks a short utterance.
    stt.callbacks?.onInterimTranscript("hi there");
    stt.callbacks?.onFinalTranscript("hi there");
    stt.callbacks?.onUtteranceEnd();

    // Flush the LLM microtask and let the reply play out.
    await vi.advanceTimersByTimeAsync(20);

    const speakers = transcript.all().map((e) => e.speaker);
    expect(speakers).toContain("caller");
    expect(transcript.all().some((e) => e.speaker === "assistant" && e.text === "This is a reply.")).toBe(true);
    expect(session.sent.length).toBeGreaterThan(0);
  });

  it("ends after two silent turns", async () => {
    vi.useFakeTimers();

    const transcript = new Transcript();
    const stt = new FakeStt();
    const loop = new AgentLoop({
      greeting: "Hello",
      systemPrompt: "system",
      maxTurns: 5,
      silenceTimeoutMs: 1500,
      stt,
      tts: new FakeTts(),
      llm: new FakeLlm(),
      transcript,
    });

    const session = new FakeSession();
    loop.start(session as unknown as MediaSession);
    session.emit("start");
    await vi.advanceTimersByTimeAsync(20);

    const endPromise = loop.waitForEnd();
    // Two silence windows, each triggering a re-prompt that also plays.
    await vi.advanceTimersByTimeAsync(1500 + 20);
    await vi.advanceTimersByTimeAsync(1500 + 20);

    await expect(endPromise).resolves.toContain("silence");
  });
});
