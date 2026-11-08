import type { TwilioClient } from "./client.js";

export interface PlaceCallOptions {
  /** Destination number in E.164 format, e.g. `+14155551234`. */
  to: string;
  /** Verified/owned caller ID in E.164 format. */
  from: string;
  /** TwiML to execute once the callee answers. */
  twiml: string;
}

export interface PlacedCall {
  sid: string;
  status: string;
}

/**
 * Places an outbound PSTN call. When the callee answers, Twilio executes the
 * supplied TwiML, which bridges audio to our media-stream server.
 */
export async function placeCall(client: TwilioClient, options: PlaceCallOptions): Promise<PlacedCall> {
  const call = await client.calls.create({
    to: options.to,
    from: options.from,
    twiml: options.twiml,
  });
  return { sid: call.sid, status: call.status ?? "unknown" };
}

/** Force-ends a live call. Used during teardown to guarantee we hang up. */
export async function endCall(client: TwilioClient, callSid: string): Promise<void> {
  await client.calls(callSid).update({ status: "completed" });
}
