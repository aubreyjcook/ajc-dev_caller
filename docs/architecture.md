# Architecture & Code Walkthrough

This document explains how `ajc-dev_caller` works, aimed at someone who knows
programming fundamentals and wants to learn by reading the code. It walks the
codebase module by module, in the order data flows through the system. Each
section points at the relevant files and, where a strong primary source exists,
links to it.

## 1. The big picture

The program has one job: place a phone call and hold a **real-time,
speech-to-speech conversation** on it. Three separate AI services cooperate on
every turn:

1. **Speech-to-text (STT)** — Deepgram turns the callee's audio into text.
2. **Large language model (LLM)** — OpenAI decides what to say next.
3. **Text-to-speech (TTS)** — Deepgram turns that text back into audio.

The audio itself flows through Twilio's [Media Streams
API](https://www.twilio.com/docs/voice/media-streams), which bridges the raw
call audio to our program over a WebSocket. We never use Twilio's own
transcription; we receive the audio bytes and do the intelligence ourselves.

```
         PSTN                      WebSocket                AI services
   callee ⇄ Twilio  ──media stream──►  our server  ──►  Deepgram STT
                                    (Node + ws)             OpenAI LLM
                                    ◄──media stream──◄  Deepgram TTS
```

## 2. The entrypoint and the `call` command

The CLI starts at [`src/cli/index.ts`](../src/cli/index.ts). It uses
[commander](https://www.npmjs.com/package/commander) to declare two
subcommands: `call` and `check`.

[`src/cli/commands/call.ts`](../src/cli/commands/call.ts) is the orchestrator.
`runCall` does, in order:

1. Validate the destination number is E.164.
2. Load and validate configuration ([`loadConfig`](../src/config/loader.ts)).
3. Construct the three AI providers (Deepgram STT, Deepgram TTS, OpenAI LLM).
4. Start a local HTTP + WebSocket server ([`MediaServer`](../src/media/server.ts)).
5. Open a public tunnel to it ([`startTunnel`](../src/util/tunnel.ts)).
6. Build TwiML pointing Twilio at our `wss://` URL ([`buildStreamTwiml`](../src/twilio/twiml.ts)).
7. Place the call ([`placeCall`](../src/twilio/outbound.ts)).
8. Hand the live stream to an [`AgentLoop`](../src/agent/loop.ts) and wait for it to finish.
9. Write the transcript, then tear everything down.

The `finally` block is important: it hangs up the call (best-effort), closes the
tunnel, and closes the server no matter how the call ends.

## 3. Configuration — [`src/config/`](../src/config/)

Two sources of configuration exist, kept separate on purpose:

- **Secrets** (API keys, tokens) come from environment variables via
  [dotenv](https://www.npmjs.com/package/dotenv) and are validated by
  `EnvSchema` in [`schema.ts`](../src/config/schema.ts).
- **Preferences** (greeting, prompt, voice, limits) come from
  `caller.config.json` and are deep-merged over `DEFAULT_CONFIG`.

Both are validated with [zod](https://zod.dev). zod lets us declare the shape
of the data once and get both runtime validation and TypeScript types from the
same declaration (`z.infer<typeof Schema>`). The loader fails fast — if a
required credential is missing, it throws before any call is placed, so we
never make a half-configured call.

Look at [`src/config/loader.ts`](../src/config/loader.ts) to see how a plain
`{}` config file is merged over the defaults and then validated.

## 4. Logging with secret redaction — [`src/util/log.ts`](../src/util/log.ts)

`registerSecrets([...])` stores every secret value up front. Every log line is
run through `redact()`, which replaces any occurrence of a secret with
`[REDACTED]` before it reaches stdout. This is a single choke-point that keeps
account SIDs and API keys out of the terminal and out of transcripts.

## 5. Twilio — [`src/twilio/`](../src/twilio/)

- [`client.ts`](../src/twilio/client.ts) wraps the [twilio
  SDK](https://www.npmjs.com/package/twilio). Note `ReturnType<typeof twilio>`
  is used as the client type instead of importing a named type — this is a
  small trick that stays correct regardless of how the package's `export =`
  declaration shapes its types.
- [`twiml.ts`](../src/twilio/twiml.ts) builds the TwiML instruction. TwiML is
  the XML vocabulary Twilio executes when a call is answered. The one verb we
  need is:

  ```xml
  <Response><Connect><Stream url="wss://…/media"/></Connect></Response>
  ```

  `<Connect><Stream>` (see the [TwiML `<Stream>`
  docs](https://www.twilio.com/docs/voice/twiml/stream)) tells Twilio to open a
  bidirectional audio stream to our WebSocket URL.
- [`outbound.ts`](../src/twilio/outbound.ts) calls
  `client.calls.create({ to, from, twiml })`. Passing `twiml` (rather than a
  `url`) means Twilio uses our instructions directly.

## 6. The media server — [`src/media/`](../src/media/)

This is the heart of the real-time system.

### Audio format — [`stream.ts`](../src/media/stream.ts)

Twilio sends audio as **µ-law (G.711 PCMU), 8 kHz, mono**, base64-encoded
inside JSON messages. µ-law is a logarithmic encoding that packs each audio
sample into one byte, so 8 kHz sampling → 8,000 bytes/second → exactly **160
bytes per 20 ms**. We use that 160-byte figure as a natural playback frame
([`MULAW_BYTES_PER_CHUNK`](../src/media/stream.ts)).

The three tiny helpers — `decodePayload`, `encodePayload`, `chunkAudio` — just
convert between base64 strings and `Buffer`s and slice audio into frames.

### WebSocket protocol — [`server.ts`](../src/media/server.ts)

`MediaServer` runs a plain Node `http.Server` with a `ws` WebSocket server
attached on the `/media` path (plus a `/health` endpoint for liveness checks).

`MediaSession` wraps a single WebSocket and translates Twilio's protocol into
simple events. Twilio's message format is documented at [Media Streams
WebSocket messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages).
The messages we care about:

| Incoming event | Meaning                                            |
| -------------- | -------------------------------------------------- |
| `connected`    | WebSocket established (we ignore it).              |
| `start`        | The stream is live; carries `streamSid`/`callSid`. |
| `media`        | A chunk of audio, with a `track` and base64 `payload`. |
| `stop`         | The stream ended.                                  |

We send three message types back:

| Outgoing event | Purpose                                                |
| -------------- | ------------------------------------------------------ |
| `media`        | Synthesized audio for the callee to hear.              |
| `clear`        | Drop our buffered audio (used on barge-in).            |
| `mark`         | A marker Twilio echoes back (not currently relied on). |

Notice the `track` field on incoming `media`: `inbound` is the callee's audio;
`outbound` is an echo of what *we* sent. We must only feed `inbound` audio to
speech-to-text, or the agent would transcribe its own voice and talk to itself.

## 7. The tunnel — [`src/util/tunnel.ts`](../src/util/tunnel.ts)

Twilio needs a public `wss://` URL, but our server runs on `localhost`. ngrok
([`@ngrok/ngrok`](https://www.npmjs.com/package/@ngrok/ngrok)) forwards a
public URL back to a local port. `startTunnel` returns both the public HTTPS
URL and the `wss://…/media` URL Twilio should dial.

## 8. Speech providers — [`src/speech/`](../src/speech/)

[`stt.ts`](../src/speech/stt.ts) and [`tts.ts`](../src/speech/tts.ts) define
small interfaces so the rest of the code never depends on a specific vendor.

- `SttProvider` reports four callbacks: interim transcript (any speech),
  final transcript (a finalized segment), utterance end (the callee finished
  speaking), and errors.
- `TtsProvider` has a single `synthesize(text) → Buffer` method returning
  µ-law/8 kHz audio.

[`deepgram-stt.ts`](../src/speech/providers/deepgram-stt.ts) talks to
Deepgram's streaming STT over a raw WebSocket rather than the Deepgram SDK
(v5's API changed substantially). The wire protocol is small: connect to
`wss://api.deepgram.com/v1/listen`, send an `Authorization: Token <key>`
header, stream binary µ-law frames, and read JSON `Results` messages. The
fields we use are `channel.alternatives[0].transcript` (the text), `is_final`
(a segment is complete), and `speech_final` (the user stopped talking). See
[Deepgram streaming
audio](https://developers.deepgram.com/docs/streaming-audio).

[`deepgram-tts.ts`](../src/speech/providers/deepgram-tts.ts) uses Deepgram's
REST `speak` endpoint with `encoding=mulaw&sample_rate=8000&container=none`, so
the response body is *already* µ-law/8 kHz matching Twilio exactly — no audio
resampling is needed. See [Deepgram
text-to-speech](https://developers.deepgram.com/docs/text-to-speech).

## 9. The LLM provider — [`src/llm/`](../src/llm/)

[`index.ts`](../src/llm/index.ts) defines a `ChatMessage` and an `LlmProvider`
with one method: `complete(messages) → string`. The agent passes the system
prompt plus the conversation history; the provider returns the assistant's next
utterance.

[`openai.ts`](../src/llm/providers/openai.ts) implements it with the OpenAI
chat-completions API. The system prompt is the most important message: it
encodes the user's `--goal` and the behavior rules, and it also acts as a mild
prompt-injection defense (the callee's speech is untrusted input; the system
prompt instructs the model to treat the goal, not the caller, as authoritative).

## 10. The agent loop — [`src/agent/`](../src/agent/)

This is where the conversation actually happens.

- [`prompt.ts`](../src/agent/prompt.ts) substitutes `{{goal}}` into the system
  prompt template.
- [`transcript.ts`](../src/agent/transcript.ts) is a small in-memory log of
  `{ speaker, text, ts }` entries with text and JSON serialization.

[`loop.ts`](../src/agent/loop.ts) implements the state machine:

```
idle ──► greeting ──► listening ⇄ thinking ──► speaking ──► ended
                        ▲            │
                        └── barge-in ┘
```

Key design points to study:

- **Continuous STT.** Speech-to-text runs for the whole call, so the callee can
  interrupt the agent mid-sentence. That's *barge-in*: when interim speech
  arrives while the agent is speaking, we stop playback and tell Twilio to
  `clear` its audio buffer.
- **The `generation` token.** `speak()` increments `generation` before
  synthesizing and playing. Every async step re-checks the generation; if a
  newer turn has superseded it, the old turn aborts cleanly. This prevents a
  stale playback from stomping on a newer one when a barge-in triggers a new
  turn. (Without it, two overlapping `setInterval` playback loops would fight.)
- **Silence handling.** While listening, a timer fires after
  `silenceTimeoutMs` if the callee stays quiet. Two consecutive silences end
  the call; one silence triggers a polite "I didn't catch that" re-prompt.
- **End-of-utterance.** Deepgram's `speech_final` flag is the primary signal
  that the callee finished speaking; the silence timer is the fallback.
- **Playback pacing.** Synthesized audio is sent to Twilio in 20 ms (160-byte)
  frames on a `setInterval`, so the callee hears natural speech and we can stop
  at a frame boundary on barge-in.

`end()` is idempotent and always closes the STT stream and the media session,
then resolves `waitForEnd()` — which is how `runCall` knows the conversation
finished.

## 11. The `check` command

[`src/cli/commands/check.ts`](../src/cli/commands/check.ts) validates
configuration, then makes two live Twilio calls — fetching the account and
looking up the caller ID — to prove the credentials work, and reports which
third-party keys are present. It places no call.

## 12. Error handling and safety

- **Fail fast on config:** no call is placed until every required credential is
  present and valid.
- **Secret redaction:** see §4.
- **Turn cap:** `maxTurns` bounds the LLM loop, and the silence logic bounds
  runaway calls.
- **Single call at a time:** `MediaServer` rejects a second concurrent stream.
- **Prompt injection:** the callee's speech is treated strictly as data; the
  system prompt anchors the model to the user's goal.

## Where to look next

Start with [`src/cli/commands/call.ts`](../src/cli/commands/call.ts) and follow
the function calls down through §5–§10. The sequence in `runCall` is the map of
the whole system.
