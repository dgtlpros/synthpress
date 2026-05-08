import { describe, expect, it } from "vitest";
import { AI_CREDIT_COSTS, type AiAction, getCreditCost } from "./config";

describe("AI_CREDIT_COSTS", () => {
  it("defines a positive integer cost for every action", () => {
    for (const [action, cost] of Object.entries(AI_CREDIT_COSTS)) {
      expect(cost, `cost for ${action}`).toBeGreaterThan(0);
      expect(Number.isInteger(cost), `cost for ${action} is integer`).toBe(
        true,
      );
    }
  });

  it("matches the v1 placeholder values from the spec", () => {
    expect(AI_CREDIT_COSTS).toEqual({
      generateIdeas: 1,
      generateOutline: 1,
      generateArticle: 5,
    });
  });

  it("orders the article cost above the ideas + outline costs", () => {
    expect(AI_CREDIT_COSTS.generateArticle).toBeGreaterThan(
      AI_CREDIT_COSTS.generateOutline,
    );
    expect(AI_CREDIT_COSTS.generateArticle).toBeGreaterThan(
      AI_CREDIT_COSTS.generateIdeas,
    );
  });
});

describe("getCreditCost", () => {
  const actions: AiAction[] = [
    "generateIdeas",
    "generateOutline",
    "generateArticle",
  ];

  it.each(actions)("returns the configured cost for %s", (action) => {
    expect(getCreditCost(action)).toBe(AI_CREDIT_COSTS[action]);
  });

  it("ignores planKey for v1 (placeholder for future per-plan pricing)", () => {
    expect(getCreditCost("generateArticle", { planKey: "starter" })).toBe(
      AI_CREDIT_COSTS.generateArticle,
    );
    expect(getCreditCost("generateArticle", { planKey: "scale" })).toBe(
      AI_CREDIT_COSTS.generateArticle,
    );
    expect(getCreditCost("generateArticle", { planKey: null })).toBe(
      AI_CREDIT_COSTS.generateArticle,
    );
  });

  it("ignores model for v1 (placeholder for future per-model pricing)", () => {
    expect(
      getCreditCost("generateArticle", { model: "claude-haiku-4-5" }),
    ).toBe(AI_CREDIT_COSTS.generateArticle);
    expect(
      getCreditCost("generateArticle", { model: "claude-sonnet-4-6" }),
    ).toBe(AI_CREDIT_COSTS.generateArticle);
  });
});
