import { describe, it, expect } from "vitest";
import { shortModelName, priceForModel, estimateCost } from "./BurnedTokensTooltip";

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

describe("priceForModel", () => {
  it("resolves current-generation model families", () => {
    expect(priceForModel("claude-opus-4-8")).toEqual({ input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 });
    expect(priceForModel("claude-sonnet-5")).toEqual({ input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 });
    expect(priceForModel("claude-haiku-4-5-20251001")).toEqual({ input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 });
  });

  it("returns null for legacy version-number-first ids to avoid mispricing", () => {
    expect(priceForModel("claude-3-opus-20240229")).toBeNull();
    expect(priceForModel("claude-3-5-sonnet-20241022")).toBeNull();
  });

  it("returns null for unknown or synthetic model strings", () => {
    expect(priceForModel("<synthetic>")).toBeNull();
    expect(priceForModel("unknown")).toBeNull();
  });
});

describe("estimateCost", () => {
  it("computes $ cost from token components at the given rate", () => {
    const price = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
    const cost = estimateCost(
      { input: 1_000_000, cacheCreation: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 },
      price
    );
    expect(cost).toBeCloseTo(5 + 6.25 + 0.5 + 25, 5);
  });

  it("returns 0 for all-zero components", () => {
    const price = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
    expect(estimateCost({ input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }, price)).toBe(0);
  });
});
