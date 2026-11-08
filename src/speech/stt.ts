/**
 * Speech-to-text provider contract.
 *
 * Providers receive raw µ-law/8 kHz audio chunks (already decoded from Twilio)
 * and report transcript events. The agent loop is the only consumer.
 */

export interface SttCallbacks {
  /** Fires on any recognized speech (interim and final). Used for barge-in. */
  onInterimTranscript(text: string): void;
  /** Fires on a finalized transcript segment. */
  onFinalTranscript(text: string): void;
  /** Fires when the callee has finished speaking (end of utterance). */
  onUtteranceEnd(): void;
  onError(err: Error): void;
}

export interface SttProvider {
  /** Open the transcription stream. May buffer audio sent before the socket is ready. */
  start(callbacks: SttCallbacks): Promise<void>;
  /** Feed a chunk of raw µ-law audio. */
  sendAudio(chunk: Buffer): void;
  /** Close the transcription stream. */
  close(): void;
}
