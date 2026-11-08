import { describe, expect, it } from "vitest";
import { buildStreamTwiml } from "../src/twilio/twiml.js";

describe("buildStreamTwiml", () => {
  it("emits a Connect/Stream pair pointing at the WebSocket URL", () => {
    const twiml = buildStreamTwiml("wss://abc123.ngrok.app/media");
    expect(twiml).toContain("<Connect>");
    expect(twiml).toContain("<Stream");
    expect(twiml).toContain('url="wss://abc123.ngrok.app/media"');
  });
});
