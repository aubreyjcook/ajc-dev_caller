import { describe, expect, it } from "vitest";
import { ConfigFileSchema, DEFAULT_CONFIG, EnvSchema } from "../src/config/schema.js";

describe("EnvSchema", () => {
  const base = {
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "tok",
    TWILIO_FROM_NUMBER: "+15551234567",
  };

  it("accepts valid environment", () => {
    expect(() => EnvSchema.parse(base)).not.toThrow();
  });

  it("rejects a missing account SID", () => {
    const { TWILIO_ACCOUNT_SID: _omit, ...rest } = base;
    expect(() => EnvSchema.parse(rest)).toThrow();
  });

  it("rejects a non-E.164 caller ID", () => {
    expect(() => EnvSchema.parse({ ...base, TWILIO_FROM_NUMBER: "15551234567" })).toThrow();
  });
});

describe("ConfigFileSchema", () => {
  it("accepts a full default config", () => {
    expect(() => ConfigFileSchema.parse(DEFAULT_CONFIG)).not.toThrow();
  });

  it("rejects an unsupported LLM provider", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    (config as { llm: { provider: string } }).llm.provider = "anthropic";
    expect(() => ConfigFileSchema.parse(config)).toThrow();
  });
});
