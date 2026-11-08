import { z } from "zod";

/**
 * Configuration schemas.
 *
 * Two sources of configuration exist:
 *  1. Secrets / credentials — read from the environment (`.env`), never committed.
 *  2. Behavioral preferences — read from `caller.config.json` (optional).
 *
 * The schemas here validate both. `EnvSchema` fails fast if Twilio credentials
 * are missing; provider API keys are optional at the schema level and validated
 * lazily when a provider is actually constructed (so a user who only uses, say,
 * Deepgram + OpenAI never needs an unused key).
 */

/** E.164 phone number: leading `+`, 7–15 digits total. */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export const EnvSchema = z.object({
  TWILIO_ACCOUNT_SID: z.string().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
  TWILIO_FROM_NUMBER: z
    .string()
    .regex(E164_PATTERN, "TWILIO_FROM_NUMBER must be E.164 (e.g. +15551234567)"),
  NGROK_AUTHTOKEN: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
});
export type Env = z.infer<typeof EnvSchema>;

/** Static, human-readable defaults merged under the user's config file. */
export const DEFAULT_CONFIG = {
  agent: {
    greeting: "Hello, this is an automated assistant.",
    systemPromptTemplate:
      "You are a phone assistant making a call on a user's behalf.\n\n" +
      "Your goal for this call is: {{goal}}\n\n" +
      "Rules:\n" +
      "- Be concise, natural, and friendly.\n" +
      "- Ask at most one question per turn.\n" +
      "- If you do not understand, ask the callee to repeat themselves.\n" +
      "- Never reveal that you are an AI unless asked directly.\n" +
      "- End the call politely once the goal is complete.",
    maxTurns: 20,
    silenceTimeoutMs: 1500,
  },
  speech: {
    stt: { provider: "deepgram", model: "nova-2-phonecall" },
    tts: { provider: "deepgram", voice: "asteria" },
  },
  llm: { provider: "openai", model: "gpt-4o-mini", temperature: 0.7 },
  tunnel: { provider: "ngrok" },
} as const;

export const ConfigFileSchema = z.object({
  agent: z.object({
    greeting: z.string().min(1),
    systemPromptTemplate: z.string().min(1),
    maxTurns: z.number().int().positive(),
    silenceTimeoutMs: z.number().int().positive(),
  }),
  speech: z.object({
    stt: z.object({
      provider: z.enum(["deepgram"]),
      model: z.string().min(1),
    }),
    tts: z.object({
      provider: z.enum(["deepgram"]),
      voice: z.string().min(1),
    }),
  }),
  llm: z.object({
    provider: z.enum(["openai"]),
    model: z.string().min(1),
    temperature: z.number().min(0).max(2),
  }),
  tunnel: z.object({
    provider: z.enum(["ngrok"]),
  }),
});
export type AppConfig = z.infer<typeof ConfigFileSchema>;
