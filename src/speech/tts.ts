/**
 * Text-to-speech provider contract.
 *
 * Providers synthesize plain text into raw µ-law/8 kHz mono audio that can be
 * sent back to Twilio with no further transcoding.
 */
export interface TtsProvider {
  synthesize(text: string): Promise<Buffer>;
}
