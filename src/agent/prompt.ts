/**
 * Builds the agent's system prompt by substituting the user's `--goal` into the
 * configured template. `{{goal}}` (whitespace-tolerant) is the placeholder.
 */
export function buildSystemPrompt(template: string, goal: string): string {
  return template.replace(/\{\{\s*goal\s*\}\}/g, goal);
}
