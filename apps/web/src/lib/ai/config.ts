/**
 * Single source of truth for what each AI action costs in synth tokens.
 *
 * Why this lives in `lib/ai/` (not server-only):
 *   The map is pure data. Both the server-side generation pipeline AND
 *   the eventual "this will cost N credits" UI hint need to read these
 *   values, so we keep it free of `import "server-only"`.
 *
 * Why a typed const map (not env vars):
 *   v1 ships with placeholder values calibrated against the seeded plan
 *   token grants — Starter 1k / Pro 5k / Scale 20k tokens per month
 *   (`supabase/seed.sql`). The numbers will be tuned once we measure
 *   real Claude usage. Making this file the only place that hardcodes
 *   them means the future tuning PR is a one-line change per action.
 *
 * What's intentionally NOT here yet (but the function signature is
 * already shaped for it):
 *   * Per-plan multipliers (`options.planKey`).
 *   * Per-model multipliers (`options.model`).
 *   * Estimated USD cost. That belongs on `usage_events.estimated_cost`,
 *     populated from real provider token usage at call time — not from
 *     this static map.
 */

export type AiAction = "generateIdeas" | "generateOutline" | "generateArticle";

/**
 * Temporary v1 costs. Tuned later when subscription / pricing details
 * are finalized. See `docs/ai-pricing.md` for the cost model.
 */
export const AI_CREDIT_COSTS: Readonly<Record<AiAction, number>> = {
  generateIdeas: 1,
  generateOutline: 1,
  generateArticle: 5,
} as const;

export interface CreditCostOptions {
  /**
   * Reserved for per-plan pricing. v1 ignores this — every plan pays
   * the same flat cost — but accepting it now means call sites are
   * already future-proofed.
   */
  planKey?: string | null;
  /**
   * Reserved for per-model pricing once we mix Haiku + Sonnet inside
   * one workflow. Same reasoning as `planKey`.
   */
  model?: string | null;
}

/**
 * Returns the synth-token cost for an AI action. Always positive (the
 * `consume_team_tokens` RPC rejects non-positive amounts, and we want
 * to fail fast in tests if someone accidentally zeroes a cost).
 */
export function getCreditCost(
  action: AiAction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future per-plan / per-model pricing
  options?: CreditCostOptions,
): number {
  const cost = AI_CREDIT_COSTS[action];
  /* v8 ignore next 3 -- defensive: the AiAction union makes this unreachable */
  if (typeof cost !== "number" || cost <= 0) {
    throw new Error(`AI_CREDIT_COSTS misconfigured for action "${action}"`);
  }
  return cost;
}
