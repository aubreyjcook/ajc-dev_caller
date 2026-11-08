#!/usr/bin/env node
import { Command } from "commander";
import { callCommand } from "./commands/call.js";
import { checkCommand } from "./commands/check.js";

const program = new Command();

program
  .name("ajc-caller")
  .description(
    "Outbound AI voice agent: place PSTN calls via Twilio and hold a real-time " +
      "speech-to-speech conversation.",
  )
  .version("0.1.0");

program.addCommand(callCommand);
program.addCommand(checkCommand);

await program.parseAsync(process.argv);
