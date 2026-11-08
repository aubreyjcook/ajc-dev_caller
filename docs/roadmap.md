# Roadmap — next version

This file records planned work for the version after v0.1.0, as required by the
project's agent instructions.

## v0.2.0 (planned)

### Reliability & call quality

- **Echo cancellation / better voice-activity detection.** The raw media stream
  can carry acoustic echo of our own TTS back through the callee's handset,
  which can cause false barge-ins. Add echo cancellation or a more robust VAD
  gate before speech-to-text.
- **Answering-machine detection.** Detect voicemail and either hang up or leave
  a message, using Twilio's answering-machine detection.
- **Call-status webhooks.** Track ringing/busy/no-answer/failed via Twilio
  status callbacks instead of only the initial `calls.create` status.
- **Retry with backoff** on transient STT/LLM/TTS failures, with a graceful
  fallback phrase.

### Conversational quality

- **Streaming TTS** (speak while synthesizing) to cut perceived latency.
- **Streaming LLM** so the reply text starts being spoken sooner.
- **Configurable end-of-call niceties** (thank the callee and summarize the
  outcome) and goal-completion detection.
- **Re-prompt tuning** — currently one "didn't catch that" re-prompt on
  silence; make this configurable.

### Providers

- **Anthropic LLM adapter** (and a general provider registry) so the LLM is
  swappable without code changes.
- **Alternative TTS** (OpenAI `tts-1`, ElevenLabs) and **STT** (OpenAI, Groq)
  adapters, behind the existing `speech`/`llm` interfaces. Non-mulaw TTS
  providers will require a resampling step down to µ-law/8 kHz.

### Operations & DX

- **Multiple concurrent calls** (the server currently accepts one stream).
- **CLI extras:** a `status`/`list` command for recent calls, and a
  `--transcript-format text` option.
- **Packaging:** a prebuilt binary or `npm` global install path, plus
  Windows/macOS/Linux CI.
- **Config validation UX:** friendlier per-field messages and a `--init` command
  that writes `.env.example` and `caller.config.json` for the user.

### Tests

- Make the test suite runnable in constrained (sandboxed) environments — e.g. a
  `node:test` runner compiled with `tsc`, avoiding the esbuild/child-process
  dependency — while keeping `vitest` for normal development.

## v0.3.0 (ideas)

- Local recording of both call legs (requires inbound/outbound track mixing).
- A small web dashboard for reviewing transcripts.
- Bring-your-own-carrier (SIP) support as an alternative to Twilio.
- Multi-language voice/prompt selection.
