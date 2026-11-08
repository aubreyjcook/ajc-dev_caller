import OpenAI from "openai";
import type { ChatMessage, LlmProvider } from "../index.js";

/**
 * OpenAI chat-completions provider. The model is configurable; the default
 * config uses `gpt-4o-mini`.
 */
export class OpenAiLlmProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly temperature: number,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: this.temperature,
      messages,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI returned an empty completion");
    }
    return content.trim();
  }
}
