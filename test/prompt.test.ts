import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/agent/prompt.js";

describe("buildSystemPrompt", () => {
  it("substitutes {{goal}} (whitespace-tolerant)", () => {
    const template = "Your goal is: {{  goal }}. Be concise.";
    expect(buildSystemPrompt(template, "book a table")).toBe(
      "Your goal is: book a table. Be concise.",
    );
  });

  it("replaces every occurrence", () => {
    const template = "Goal: {{goal}}. Remember: {{goal}}.";
    expect(buildSystemPrompt(template, "X")).toBe("Goal: X. Remember: X.");
  });
});
