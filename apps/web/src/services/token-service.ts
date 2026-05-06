import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

export type TokenTransaction = Tables<"token_transactions">;
export type TokenGrantType =
  | "signup_grant"
  | "subscription_grant"
  | "top_up_purchase"
  | "refund"
  | "adjustment";

/**
 * Types accepted by the `grant_tokens` Postgres RPC. The DB enforces this
 * separately, but we keep it in TS too so callers fail at compile time.
 */
export type GrantTokensType = Exclude<TokenGrantType, "refund">;

type Client = SupabaseClient<Database>;

export async function getBalance(
  userId: string,
  client?: Client,
): Promise<number> {
  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.balance ?? 0;
}

export async function getRecentTransactions(
  userId: string,
  options: { limit?: number; client?: Client } = {},
): Promise<TokenTransaction[]> {
  const limit = options.limit ?? 10;
  const supabase = options.client ?? createAdminClient();
  const { data, error } = await supabase
    .from("token_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/**
 * Grants tokens to a user, increment-style. Atomic: the audit-log insert and
 * the balance increment happen in a single Postgres transaction inside the
 * `grant_tokens` RPC, so concurrent webhook deliveries can't lose grants
 * due to a stale-balance race.
 *
 * Idempotent when `stripeEventId` is provided: a duplicate event is detected
 * by the unique `token_transactions.stripe_event_id` index and the balance
 * is not double-incremented.
 *
 * Returns the new balance, or null when the event was already processed.
 */
export async function grantTokens(params: {
  userId: string;
  amount: number;
  type: GrantTokensType;
  description?: string;
  stripeEventId?: string;
  metadata?: Record<string, unknown>;
  client?: Client;
}): Promise<number | null> {
  if (params.amount <= 0) {
    throw new Error("grantTokens: amount must be positive");
  }

  const supabase = params.client ?? createAdminClient();

  const { data, error } = await supabase.rpc("grant_tokens", {
    p_user_id: params.userId,
    p_amount: params.amount,
    p_type: params.type,
    p_description: params.description ?? undefined,
    p_stripe_event_id: params.stripeEventId ?? undefined,
    p_metadata: (params.metadata ?? {}) as Json,
  });

  if (error) throw error;
  return data ?? null;
}

/**
 * Records a refund/chargeback of a previous grant. Atomic: the audit-log
 * insert, the balance lock, and the decrement all happen in a single
 * Postgres transaction inside the `record_token_refund` RPC. The balance
 * is clamped at zero — we never go negative — and the audit row is always
 * written so the refund is observable even when there's nothing left to
 * deduct.
 *
 * Idempotent on `stripeEventId`. Returns `null` when the event was already
 * processed; otherwise `{ requested, deducted, balance }` describing what
 * actually happened.
 */
export async function recordTokenRefund(params: {
  userId: string;
  amount: number;
  description?: string;
  stripeEventId?: string;
  metadata?: Record<string, unknown>;
  client?: Client;
}): Promise<{ requested: number; deducted: number; balance: number } | null> {
  if (params.amount <= 0) {
    throw new Error("recordTokenRefund: amount must be positive");
  }

  const supabase = params.client ?? createAdminClient();

  const { data, error } = await supabase.rpc("record_token_refund", {
    p_user_id: params.userId,
    p_amount: params.amount,
    p_stripe_event_id: params.stripeEventId ?? undefined,
    p_description: params.description ?? undefined,
    p_metadata: (params.metadata ?? {}) as Json,
  });

  if (error) throw error;
  if (data === null) return null;

  // The RPC returns `jsonb` shaped as { requested, deducted, balance }.
  const result = data as {
    requested: number;
    deducted: number;
    balance: number;
  };
  return result;
}

export type SubscriptionEventType =
  | "subscription_canceled"
  | "subscription_resumed"
  | "plan_downgraded";

/**
 * Records a non-token subscription lifecycle event (cancel / resume /
 * downgrade) so it shows up in the Recent Activity feed alongside actual
 * token operations. The row has `amount: 0` — these are purely informational
 * audit entries. Idempotent on `stripeEventId`; callers should compose a
 * per-transition suffix (e.g. `evt_xxx::canceled`) so several transitions
 * driven by the same Stripe event each get their own row.
 *
 * Returns `true` when a row was inserted, `false` when the event was already
 * processed (idempotent skip).
 */
export async function recordSubscriptionEvent(params: {
  userId: string;
  type: SubscriptionEventType;
  description: string;
  stripeEventId: string;
  metadata?: Record<string, unknown>;
  client?: Client;
}): Promise<boolean> {
  const supabase = params.client ?? createAdminClient();

  const { data: existing } = await supabase
    .from("token_transactions")
    .select("id")
    .eq("stripe_event_id", params.stripeEventId)
    .maybeSingle();

  if (existing) return false;

  const { error } = await supabase.from("token_transactions").insert({
    user_id: params.userId,
    amount: 0,
    type: params.type,
    description: params.description,
    stripe_event_id: params.stripeEventId,
    metadata: (params.metadata ??
      {}) as Tables<"token_transactions">["metadata"],
  });

  if (error) {
    if (error.code === "23505") return false;
    throw error;
  }

  return true;
}

/**
 * Atomically deducts tokens via the consume_tokens Postgres function.
 * Throws "insufficient_tokens" when the balance is too low.
 */
export async function consumeTokens(params: {
  userId: string;
  amount: number;
  description?: string;
  client?: Client;
}): Promise<number> {
  if (params.amount <= 0) {
    throw new Error("consumeTokens: amount must be positive");
  }

  const supabase = params.client ?? createAdminClient();

  const { data, error } = await supabase.rpc("consume_tokens", {
    p_user_id: params.userId,
    p_amount: params.amount,
    p_description: params.description ?? undefined,
  });

  if (error) {
    if (error.message?.includes("insufficient_tokens")) {
      throw new Error("insufficient_tokens");
    }
    throw error;
  }

  return data ?? 0;
}
