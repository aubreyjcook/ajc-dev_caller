import twilio from "twilio";

/**
 * Twilio REST client factory.
 *
 * The `twilio` package's default export is a callable factory plus namespaces
 * (`.twiml`, `.jwt`, ...). We capture the concrete client type via
 * `ReturnType` rather than importing a named type, which keeps us resilient to
 * how the package's `export =` declaration shapes its types.
 */

export type TwilioClient = ReturnType<typeof twilio>;

export function createTwilioClient(accountSid: string, authToken: string): TwilioClient {
  return twilio(accountSid, authToken);
}
