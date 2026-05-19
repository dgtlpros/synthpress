import { describe, expect, it } from "vitest";
import { providerDisplayLabel } from "./image-provider-label";

describe("providerDisplayLabel", () => {
  it("returns 'Pexels' for the active provider id", () => {
    expect(providerDisplayLabel("pexels")).toBe("Pexels");
  });

  it("returns 'Unsplash' for the legacy provider id", () => {
    expect(providerDisplayLabel("unsplash")).toBe("Unsplash");
  });

  it("falls through to the raw provider id for unknown / future providers", () => {
    // Forward-compat: a malformed or future provider value
    // surfaces as the raw id, never silently hidden.
    expect(providerDisplayLabel("midjourney")).toBe("midjourney");
    expect(providerDisplayLabel("manual_url")).toBe("manual_url");
  });

  it("returns an empty string for null", () => {
    expect(providerDisplayLabel(null)).toBe("");
  });

  it("returns an empty string for undefined", () => {
    expect(providerDisplayLabel(undefined)).toBe("");
  });

  it("returns an empty string for an empty string input", () => {
    // Empty string is truthy as a typeof check but falsy via `!provider`,
    // so the early return fires.
    expect(providerDisplayLabel("")).toBe("");
  });

  it("returns an empty string when given a non-string value (defensive)", () => {
    // Real callers pass `string | null | undefined`, but a bad
    // jsonb row with a number could leak through. The early
    // return treats it the same as `null` instead of crashing.
    expect(providerDisplayLabel(42 as unknown as string)).toBe("");
  });
});
