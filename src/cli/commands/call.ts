import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../../config/loader.js";
import { E164_PATTERN } from "../../config/schema.js";
import { registerSecrets, setLogLevel, log } from "../../util/log.js";
import { MediaServer } from "../../media/server.js";
import { startTunnel } from "../../util/tunnel.js";
import type { Tunnel } from "../../util/tunnel.js";
import { buildStreamTwiml } from "../../twilio/twiml.js";
import { createTwilioClient } from "../../twilio/client.js";
import type { TwilioClient } from "../../twilio/client.js";
import { endCall, placeCall } from "../../twilio/outbound.js";
import { DeepgramSttProvider } from "../../speech/providers/deepgram-stt.js";
import { DeepgramTtsProvider } from "../../speech/providers/deepgram-tts.js";
import { OpenAiLlmProvider } from "../../llm/providers/openai.js";
import { AgentLoop } from "../../agent/loop.js";
import { Transcript } from "../../agent/transcript.js";
import { buildSystemPrompt } from "../../agent/prompt.js";

interface CallOptions {
  goal: string;
  from?: string;
  voice?: string;
  maxTurns?: number;
  transcript?: string;
  dryRun?: boolean;
  config?: string;
  debug?: boolean;
}

export const callCommand = new Command("call")
  .description("Place an outbound AI voice call to a phone number")
  .argument("<number>", "phone number to call (E.164)")
  .requiredOption("-g, --goal <text>", "conversation objective for the agent")
  .option("--from <number>", "override the caller ID (E.164)")
  .option("--voice <name>", "override the text-to-speech voice")
  .option("--max-turns <n>", "override the maximum agent turns", (v) => parseInt(v, 10))
  .option("-t, --transcript <path>", "where to write the transcript", "transcript.json")
  .option("--dry-run", "validate config and print TwiML without calling")
  .option("-c, --config <path>", "path to the config file", "caller.config.json")
  .option("--debug", "enable debug logging")
  .action(async (number: string, options: CallOptions) => {
    await runCall(number, options);
  });

async function runCall(number: string, options: CallOptions): Promise<void> {
  if (options.debug) setLogLevel("debug");

  if (!E164_PATTERN.test(number)) {
    console.error(`Invalid destination "${number}" — must be E.164 (e.g. +15551234567).`);
    process.exitCode = 2;
    return;
  }

  let loaded;
  try {
    loaded = loadConfig(options.config);
  } catch (err) {
    console.error("Configuration error: " + (err as Error).message);
    process.exitCode = 2;
    return;
  }
  const { env, config } = loaded;

  registerSecrets([
    env.TWILIO_ACCOUNT_SID,
    env.TWILIO_AUTH_TOKEN,
    env.NGROK_AUTHTOKEN,
    env.DEEPGRAM_API_KEY,
    env.OPENAI_API_KEY,
  ]);

  const from = options.from ?? env.TWILIO_FROM_NUMBER;
  if (!E164_PATTERN.test(from)) {
    console.error(`Invalid caller ID "${from}" — must be E.164 (e.g. +15551234567).`);
    process.exitCode = 2;
    return;
  }

  if (!env.DEEPGRAM_API_KEY) {
    console.error("Missing DEEPGRAM_API_KEY (required for speech-to-text and text-to-speech).");
    process.exitCode = 2;
    return;
  }
  if (!env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY (required for the language model).");
    process.exitCode = 2;
    return;
  }

  const voice = options.voice ?? config.speech.tts.voice;
  const maxTurns = options.maxTurns ?? config.agent.maxTurns;
  if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
    console.error(`Invalid --max-turns "${maxTurns}" — must be a positive integer.`);
    process.exitCode = 2;
    return;
  }
  const systemPrompt = buildSystemPrompt(config.agent.systemPromptTemplate, options.goal);

  const stt = new DeepgramSttProvider(env.DEEPGRAM_API_KEY, config.speech.stt.model);
  const tts = new DeepgramTtsProvider(env.DEEPGRAM_API_KEY, voice);
  const llm = new OpenAiLlmProvider(env.OPENAI_API_KEY, config.llm.model, config.llm.temperature);

  const server = new MediaServer();
  let tunnel: Tunnel | undefined;
  let client: TwilioClient | undefined;
  let callSid: string | undefined;

  try {
    const port = await server.start(0);
    tunnel = await startTunnel(port, env.NGROK_AUTHTOKEN);
    const twiml = buildStreamTwiml(tunnel.wsUrl);

    if (options.dryRun) {
      log.info("Dry run — here is the TwiML that would be used:\n" + twiml);
      return;
    }

    client = createTwilioClient(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

    const transcript = new Transcript();
    const loop = new AgentLoop({
      greeting: config.agent.greeting,
      systemPrompt,
      maxTurns,
      silenceTimeoutMs: config.agent.silenceTimeoutMs,
      stt,
      tts,
      llm,
      transcript,
    });
    server.on("session", (session) => loop.start(session));

    const call = await placeCall(client, { to: number, from, twiml });
    callSid = call.sid;
    log.info(`Call placed (${call.sid}) — status ${call.status}`);

    const reason = await loop.waitForEnd();
    log.info("Conversation complete: " + reason);

    const transcriptPath = options.transcript ?? "transcript.json";
    const output = {
      callSid: call.sid,
      reason,
      entries: transcript.toJSON(),
    };
    writeFileSync(transcriptPath, JSON.stringify(output, null, 2) + "\n");
    log.info("Transcript written to " + transcriptPath);
  } finally {
    if (callSid && client) {
      try {
        await endCall(client, callSid);
      } catch {
        // The call may already be over; ignore teardown errors.
      }
    }
    await tunnel?.close();
    await server.close();
  }
}
