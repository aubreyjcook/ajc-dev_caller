/**
 * Large-language-model provider contract.
 *
 * The agent loop hands the provider a full message list (system prompt + the
 * conversation so far) and expects a single assistant reply as text.
 */
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LlmProvider {
  complete(messages: ChatMessage[]): Promise<string>;
}
