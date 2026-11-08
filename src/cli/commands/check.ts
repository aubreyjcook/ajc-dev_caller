import { Command } from "commander";
import { loadConfig } from "../../config/loader.js";
import { registerSecrets, log } from "../../util/log.js";
import { createTwilioClient } from "../../twilio/client.js";

interface CheckOptions {
  config?: string;
}

export const checkCommand = new Command("check")
  .description("Validate configuration and credentials without placing a call")
  .option("-c, --config <path>", "path to the config file", "caller.config.json")
  .action(async (options: CheckOptions) => {
    await runCheck(options);
  });

async function runCheck(options: CheckOptions): Promise<void> {
  let loaded;
  try {
    loaded = loadConfig(options.config);
  } catch (err) {
    console.error("Configuration error: " + (err as Error).message);
    process.exitCode = 2;
    return;
  }
  const { env } = loaded;

  registerSecrets([
    env.TWILIO_ACCOUNT_SID,
    env.TWILIO_AUTH_TOKEN,
    env.NGROK_AUTHTOKEN,
    env.DEEPGRAM_API_KEY,
    env.OPENAI_API_KEY,
  ]);

  log.info("Configuration: " + loaded.configPath);

  // Twilio credentials.
  const client = createTwilioClient(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  try {
    const account = await client.api.accounts(env.TWILIO_ACCOUNT_SID).fetch();
    log.info(`Twilio credentials: OK (account "${account.friendlyName}")`);
  } catch (err) {
    log.error("Twilio credentials: INVALID — " + (err as Error).message);
  }

  // Caller ID is a phone number on the account.
  try {
    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: env.TWILIO_FROM_NUMBER });
    if (numbers.length > 0) {
      log.info(`Caller ID ${env.TWILIO_FROM_NUMBER}: OK`);
    } else {
      log.warn(`Caller ID ${env.TWILIO_FROM_NUMBER}: not found as an incoming number (must still be verified)`);
    }
  } catch (err) {
    log.warn("Could not verify caller ID: " + (err as Error).message);
  }

  // Third-party service keys.
  log.info(env.NGROK_AUTHTOKEN ? "ngrok authtoken: present" : "ngrok authtoken: MISSING (NGROK_AUTHTOKEN)");
  log.info(env.DEEPGRAM_API_KEY ? "Deepgram API key: present" : "Deepgram API key: MISSING (DEEPGRAM_API_KEY)");
  log.info(env.OPENAI_API_KEY ? "OpenAI API key: present" : "OpenAI API key: MISSING (OPENAI_API_KEY)");
}
