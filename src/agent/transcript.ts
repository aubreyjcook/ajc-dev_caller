/**
 * In-memory conversation transcript with serialization helpers.
 */
export type Speaker = "assistant" | "caller" | "system";

export interface TranscriptEntry {
  speaker: Speaker;
  text: string;
  ts: string;
}

export class Transcript {
  private readonly list: TranscriptEntry[] = [];

  add(speaker: Speaker, text: string): void {
    this.list.push({ speaker, text, ts: new Date().toISOString() });
  }

  all(): readonly TranscriptEntry[] {
    return this.list;
  }

  /** Human-readable, line-per-utterance rendering. */
  toText(): string {
    return this.list.map((entry) => `[${entry.speaker}] ${entry.text}`).join("\n");
  }

  /** Structured form suitable for JSON serialization. */
  toJSON(): TranscriptEntry[] {
    return this.list;
  }
}
