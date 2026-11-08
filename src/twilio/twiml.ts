import twilio from "twilio";

/**
 * Builds the TwiML that instructs Twilio to bridge the live call audio to our
 * media-stream WebSocket server.
 *
 * `<Connect><Stream url="wss://..."/></Connect>` opens a bidirectional media
 * stream: Twilio sends us the callee's audio (µ-law/8 kHz) and plays back any
 * audio we send. See the Twilio `<Stream>` docs for the full protocol:
 * https://www.twilio.com/docs/voice/twiml/stream
 */

export function buildStreamTwiml(wsUrl: string): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  const connect = response.connect();
  connect.stream({ url: wsUrl });
  return response.toString();
}
