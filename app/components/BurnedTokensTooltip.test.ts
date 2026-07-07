import { describe, it, expect } from "vitest";
import { shortModelName } from "./BurnedTokensTooltip";

describe("shortModelName", () => {
  it("formats a plain model id as family + dotted version", () => {
    expect(shortModelName("claude-opus-4-8")).toBe("Opus 4.8");
    expect(shortModelName("claude-sonnet-4-6")).toBe("Sonnet 4.6");
  });

  it("formats a single-segment version without a dot", () => {
    expect(shortModelName("claude-sonnet-5")).toBe("Sonnet 5");
  });

  it("drops a trailing date suffix", () => {
    expect(shortModelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  });

  it("falls back to the raw id when it doesn't match the expected shape", () => {
    expect(shortModelName("<synthetic>")).toBe("<synthetic>");
    expect(shortModelName("unknown")).toBe("unknown");
  });
});
