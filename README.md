# ajc-dev_caller

An outbound **AI voice agent** as a command-line tool. It places a real phone
call through [Twilio Programmable Voice](https://www.twilio.com/docs/voice),
then holds a real-time, speech-to-speech conversation: it speaks to the callee
(text-to-speech), transcribes what the callee says (speech-to-text), decides the
next reply with a large language model, and speaks back — looping until the
call ends. A full transcript is saved when the call finishes.

Built in **TypeScript (Node.js)**.

---

## How it works (30-second version)

```
ajc-caller call +15551234567 --goal "Ask about their store hours"
      │
      ├─ 1. Starts a local HTTP + WebSocket server
      ├─ 2. Opens a public tunnel (ngrok) so Twilio can reach it
      ├─ 3. Places the outbound call via the Twilio REST API
      └─ 4. Twilio bridges the live audio to us over a WebSocket
               ├─ callee audio  ──► speech-to-text (Deepgram) ──► text
               ├─ text          ──► LLM (OpenAI)              ──► reply text
               └─ reply text    ──► text-to-speech (Deepgram) ──► callee audio
```

The audio never goes through Twilio's own transcription; we receive the raw
call audio in real time via [Twilio Media
Streams](https://www.twilio.com/docs/voice/media-streams) and do our own
speech-to-text / text-to-speech / LLM orchestration.

---

## Prerequisites

You need accounts and credentials for four services (all with free or trial
tiers):

| Service  | Used for                          | Where to get a key                                        |
| -------- | --------------------------------- | --------------------------------------------------------- |
| Twilio   | Placing the call + media stream   | [Twilio Console](https://console.twilio.com)              |
| ngrok    | Public tunnel to your local server| [ngrok dashboard](https://dashboard.ngrok.com)            |
| Deepgram | Speech-to-text + text-to-speech   | [Deepgram Console](https://console.deepgram.com)          |
| OpenAI   | The language model (LLM)          | [OpenAI platform](https://platform.openai.com/api-keys)   |

Twilio specifics:

- A phone number you own (or have verified) that can make outbound calls — it
  becomes the caller ID.
- Your **Account SID** and **Auth Token**.

---

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Create your environment file from the template
cp .env.example .env       # then edit .env with real values

# 3. (Optional) create a config file with non-secret preferences
cp caller.config.example.json caller.config.json
```

All secrets live in `.env` (which is gitignored). The optional
`caller.config.json` holds non-secret preferences such as the greeting, the
system prompt, and the TTS voice.

### Environment variables (`.env`)

| Variable              | Required | Description                                  |
| --------------------- | -------- | -------------------------------------------- |
| `TWILIO_ACCOUNT_SID`  | yes      | Twilio account identifier                    |
| `TWILIO_AUTH_TOKEN`   | yes      | Twilio API secret                            |
| `TWILIO_FROM_NUMBER`  | yes      | Caller ID, E.164 (e.g. `+15551234567`)       |
| `NGROK_AUTHTOKEN`     | yes      | ngrok authtoken for the public tunnel        |
| `DEEPGRAM_API_KEY`    | yes      | For speech-to-text and text-to-speech        |
| `OPENAI_API_KEY`      | yes      | For the language model                       |
| `OPENAI_MODEL`        | no       | Overrides the LLM model (default `gpt-4o-mini`) |

---

## Usage

### Verify your setup

```bash
pnpm build
pnpm start check
# or, without building first:  pnpm typecheck && node dist/cli/index.js check
```

`check` validates your configuration, Twilio credentials, and caller ID, and
reports which provider keys are present — without placing a call.

### Place a call

```bash
node dist/cli/index.js call +14155551234 --goal "Ask if the store has same-day delivery"
```

Options for `call`:

| Option                   | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `-g, --goal <text>`      | **Required.** The conversation objective.          |
| `--from <number>`        | Override the caller ID (E.164).                    |
| `--voice <name>`         | Override the TTS voice (e.g. `asteria`, `luna`).   |
| `--max-turns <n>`        | Override the maximum number of agent turns.        |
| `-t, --transcript <path>`| Where to write the transcript (default `transcript.json`). |
| `--dry-run`              | Validate and print the TwiML without calling.      |
| `-c, --config <path>`    | Path to the config file (default `caller.config.json`). |
| `--debug`                | Verbose logging.                                   |

Example with overrides:

```bash
node dist/cli/index.js call +14155551234 \
  --goal "Reschedule my 3pm appointment to tomorrow" \
  --voice luna \
  --max-turns 12 \
  --transcript call-2026-11-08.json
```

The transcript is JSON with an `entries` array of
`{ speaker, text, ts }` records (`speaker` is `assistant`, `caller`, or
`system`).

---

## Configuration reference (`caller.config.json`)

All keys are optional — defaults come from
[`src/config/schema.ts`](src/config/schema.ts).

```jsonc
{
  "agent": {
    "greeting": "Hello, this is an automated assistant.",
    "systemPromptTemplate": "You are a phone assistant… Goal: {{goal}} …",
    "maxTurns": 20,            // safety cap on LLM turns
    "silenceTimeoutMs": 1500   // how long to wait for speech before acting
  },
  "speech": {
    "stt": { "provider": "deepgram", "model": "nova-2-phonecall" },
    "tts": { "provider": "deepgram", "voice": "asteria" }
  },
  "llm": {
    "provider": "openai", "model": "gpt-4o-mini", "temperature": 0.7
  },
  "tunnel": { "provider": "ngrok" }
}
```

The `{{goal}}` placeholder in `systemPromptTemplate` is replaced with the
`--goal` you pass on the command line.

---

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm build       # compile to dist/
pnpm start       # run the compiled CLI (node dist/cli/index.js)
pnpm dev         # run from source with tsx
pnpm test        # run the vitest suite
```

---

## Project structure

```
src/
  cli/            entrypoint + call/check commands (commander)
  config/         env + JSON config loading and zod validation
  twilio/         REST client, TwiML builder, outbound call
  media/          HTTP + WebSocket server; Twilio media protocol helpers
  speech/         STT/TTS interfaces + Deepgram providers
  llm/            LLM interface + OpenAI provider
  agent/          conversation state machine, prompt, transcript
  util/           logging (with secret redaction) and the ngrok tunnel
test/             vitest unit + integration tests
```

For a guided walkthrough of the code (written for someone learning by reading
it), see [`docs/architecture.md`](docs/architecture.md). For planned work, see
[`docs/roadmap.md`](docs/roadmap.md).

---

## Primary sources

- [Twilio Media Streams overview](https://www.twilio.com/docs/voice/media-streams)
- [Twilio Media Streams WebSocket messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages)
- [TwiML `<Stream>`](https://www.twilio.com/docs/voice/twiml/stream)
- [TwiML `<Connect>`](https://www.twilio.com/docs/voice/twiml/connect)
- [Deepgram streaming speech-to-text](https://developers.deepgram.com/docs/streaming-audio)
- [Deepgram text-to-speech](https://developers.deepgram.com/docs/text-to-speech)
- [ngrok JavaScript SDK](https://ngrok.com/docs/using-the-ngrok-agent-with-javascript/)
