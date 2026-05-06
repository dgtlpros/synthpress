import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSubscription } from "./billing-service";
import { getBalance } from "./token-service";

type Client = SupabaseClient<Database>;

export interface ConsumeTeamTokensInput {
  teamId: string;
  amount: number;
  actingUserId: string;
  description?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  client?: Client;
}

/**
 * Atomically debits the team owner's token balance and writes an audit row
 * via the `consume_team_tokens` RPC. The RPC resolves the owner from
 * `teams.billing_user_id`, debits, and inserts the transaction in a single
 * Postgres transaction — there is no read-then-write race even if the
 * owner is being changed concurrently (a future ownership-transfer feature
 * deferred from v1).
 *
 * Always stamps `team_id` and `acting_user_id` into transaction metadata
 * (in addition to anything the caller passes) so the owner's per-team
 * usage view can attribute every spend to a project/blog and the member
 * who triggered it.
 *
 * Errors raised:
 *   - "amount_must_be_positive"  - amount <= 0
 *   - "team_has_no_billing_user" - teams.billing_user_id is null
 *   - "insufficient_tokens"      - owner's balance < amount
 *
 * Idempotent on `idempotencyKey`: a duplicate key short-circuits in the
 * RPC and the unique partial index on `token_transactions.idempotency_key`
 * catches concurrent retries.
 */
export async function consumeTeamTokens(input: ConsumeTeamTokensInput): Promise<number> {
  if (input.amount <= 0) {
    throw new Error("consumeTeamTokens: amount must be positive");
  }

  const supabase = input.client ?? createAdminClient();

  const { data, error } = await supabase.rpc("consume_team_tokens", {
    p_team_id: input.teamId,
    p_amount: input.amount,
    p_acting_user_id: input.actingUserId,
    p_description: input.description ?? undefined,
    p_metadata: (input.metadata ?? {}) as Json,
    p_idempotency_key: input.idempotencyKey ?? undefined,
  });

  if (error) {
    if (error.message?.includes("insufficient_tokens")) {
      throw new Error("insufficient_tokens");
    }
    if (error.message?.includes("team_has_no_billing_user")) {
      throw new Error("team_has_no_billing_user");
    }
    if (error.message?.includes("amount_must_be_positive")) {
      throw new Error("amount_must_be_positive");
    }
    throw error;
  }

  return data ?? 0;
}

export interface TeamBillingContext {
  ownerId: string;
  planKey: string | null;
  status: string | null;
  balance: number;
}

/**
 * Resolves the team's billing context: the owner user id, their currently
 * active subscription plan key + status (or null when on the free tier),
 * and the owner's current token balance. This is what UI uses to gate
 * features ("does this team's plan include X?") and to show the
 * "Spending {TeamName} balance" sidebar context.
 */
export async function getTeamPlan(
  teamId: string,
  client?: Client,
): Promise<TeamBillingContext | null> {
  const supabase = client ?? createAdminClient();

  const { data: team, error: teamErr } = await supabase
    .from("teams")
    .select("billing_user_id")
    .eq("id", teamId)
    .maybeSingle();

  if (teamErr) throw teamErr;
  if (!team?.billing_user_id) return null;

  const ownerId = team.billing_user_id;
  const [subscription, balance] = await Promise.all([
    getActiveSubscription(ownerId, supabase),
    getBalance(ownerId, supabase),
  ]);

  return {
    ownerId,
    planKey: subscription?.plan_key ?? null,
    status: subscription?.status ?? null,
    balance,
  };
}
