import { describe, expect, it } from "vitest";
import { Transcript } from "../src/agent/transcript.js";

describe("Transcript", () => {
  it("records entries in order and serializes", () => {
    const t = new Transcript();
    t.add("system", "call started");
    t.add("assistant", "hello");
    t.add("caller", "hi");

    expect(t.all().map((e) => e.speaker)).toEqual(["system", "assistant", "caller"]);
    expect(t.toJSON()).toHaveLength(3);
    expect(t.toText()).toContain("[caller] hi");
  });
});
