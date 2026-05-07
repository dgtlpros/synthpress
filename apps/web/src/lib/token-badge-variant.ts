import type { TokenBadgeVariant } from "@/components/atoms/TokenBadge";

/**
 * Centralized policy for picking a TokenBadge color variant from a balance.
 *
 * Lime is the canonical "synth tokens" identity color — it shows up on every
 * surface that displays a token amount, so users learn to recognize the lime
 * pill as "this is a token count" at a glance.
 *
 * The only exception is when the balance is critically low (≤ 50): we
 * switch to the amber `warning` variant to surface "you're about to run
 * out" without the user having to read the number. Below the threshold,
 * legibility/identity takes a back seat to the alert.
 *
 *   - `warning`  balance ≤ LOW_BALANCE_THRESHOLD (50) — running out
 *   - `lime`     everywhere else
 *
 * Keeping this in a shared resolver (rather than duplicating the ternary in
 * every page) ensures the navbar token badge, the dashboard hero, the
 * TokenBalanceCard, and any future surface all agree on what "low" means —
 * change the threshold once, propagates everywhere.
 */

export const LOW_BALANCE_THRESHOLD = 50;

export interface PickTokenBadgeVariantInput {
  balance: number;
}

export function pickTokenBadgeVariant(
  input: PickTokenBadgeVariantInput,
): TokenBadgeVariant {
  if (input.balance <= LOW_BALANCE_THRESHOLD) return "warning";
  return "lime";
}
