import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigFileSchema, DEFAULT_CONFIG, EnvSchema } from "./schema.js";
import type { AppConfig, Env } from "./schema.js";

/**
 * Loads and validates configuration.
 *
 * - Environment (`.env`) supplies secrets. `dotenv/config` has already populated
 *   `process.env` from the current working directory.
 * - `caller.config.json` (or `configPath`) supplies behavioral preferences and
 *   is deep-merged over {@link DEFAULT_CONFIG} so every key always has a value.
 *
 * Fails fast (throws) when required credentials are missing or malformed so a
 * call is never half-placed on bad configuration.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively merge `overrides` onto `base` (plain objects only). */
function deepMerge<T>(base: T, overrides: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    return (overrides === undefined ? base : (overrides as T));
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = deepMerge(out[key], value);
  }
  return out as T;
}

export interface LoadedConfig {
  env: Env;
  config: AppConfig;
  configPath: string;
}

/** Turn a zod validation error (or any thrown value) into a readable message. */
function formatError(err: unknown): string {
  if (err && typeof err === "object" && Array.isArray((err as { issues?: unknown[] }).issues)) {
    const issues = (err as { issues: Array<{ path: Array<string | number>; message: string }> }).issues;
    return issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
  }
  return (err as Error).message;
}

export function loadConfig(configPath = "caller.config.json"): LoadedConfig {
  let env: Env;
  try {
    env = EnvSchema.parse(process.env);
  } catch (err) {
    throw new Error("invalid environment: " + formatError(err));
  }

  const resolvedPath = resolve(configPath);
  let raw: unknown = {};
  if (existsSync(resolvedPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(resolvedPath, "utf8"));
    } catch (err) {
      throw new Error(`Could not parse config file "${resolvedPath}": ${(err as Error).message}`);
    }
    raw = parsed;
  }

  const merged = deepMerge(DEFAULT_CONFIG, raw);
  let config: AppConfig;
  try {
    config = ConfigFileSchema.parse(merged);
  } catch (err) {
    throw new Error(`invalid config file "${resolvedPath}": ` + formatError(err));
  }

  return { env, config, configPath: resolvedPath };
}
