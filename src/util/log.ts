import { inspect } from "node:util";

/**
 * Minimal logger with secret redaction.
 *
 * Register every secret value up front (via {@link registerSecrets}) and any
 * log line containing one will have it replaced with `[REDACTED]` before it
 * reaches stdout/stderr. This is the single choke-point that keeps account
 * SIDs, auth tokens, and API keys out of terminal output and transcripts.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

let currentLevel: LogLevel = "info";
const secrets: string[] = [];

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function registerSecrets(values: Array<string | undefined>): void {
  for (const value of values) {
    if (value && value.length >= 6) secrets.push(value);
  }
}

function redact(input: string): string {
  let output = input;
  for (const secret of secrets) {
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return inspect(value, { depth: 4, colors: false });
}

function emit(level: LogLevel, args: unknown[]): void {
  const line = redact(args.map(stringify).join(" "));
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (...args: unknown[]): void => {
    if (currentLevel === "debug") emit("debug", args);
  },
  info: (...args: unknown[]): void => emit("info", args),
  warn: (...args: unknown[]): void => emit("warn", args),
  error: (...args: unknown[]): void => emit("error", args),
};
