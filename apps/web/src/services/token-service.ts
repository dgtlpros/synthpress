import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

export type TokenTransaction = Tables<"token_transactions">;
export type TokenGrantType =
  | "signup_grant"
  | "subscription_grant"
  | "top_up_purchase"
  | "refund"
  | "adjustment";

type Client = SupabaseClient<Database>;

export async function getBalance(userId: string, client?: Client): Promise<number> {
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
 * Grants tokens to a user, increment-style. Idempotent when stripeEventId is
 * provided: a duplicate event is detected by the unique stripe_event_id index
 * and the balance is not double-incremented.
 *
 * Returns the new balance, or null if the grant was skipped due to duplicate.
 */
export async function grantTokens(params: {
  userId: string;
  amount: number;
  type: TokenGrantType;
  description?: string;
  stripeEventId?: string;
  metadata?: Record<string, unknown>;
  client?: Client;
}): Promise<number | null> {
  if (params.amount <= 0) {
    throw new Error("grantTokens: amount must be positive");
  }

  const supabase = params.client ?? createAdminClient();

  if (params.stripeEventId) {
    const { data: existing } = await supabase
      .from("token_transactions")
      .select("id")
      .eq("stripe_event_id", params.stripeEventId)
      .maybeSingle();

    if (existing) {
      return null;
    }
  }

  const { error: txError } = await supabase.from("token_transactions").insert({
    user_id: params.userId,
    amount: params.amount,
    type: params.type,
    description: params.description ?? null,
    stripe_event_id: params.stripeEventId ?? null,
    metadata: (params.metadata ?? {}) as Tables<"token_transactions">["metadata"],
  });

  if (txError) {
    if (txError.code === "23505") {
      return null;
    }
    throw txError;
  }

  const { data: existingBalance } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("user_id", params.userId)
    .maybeSingle();

  const newBalance = (existingBalance?.balance ?? 0) + params.amount;

  const { error: balError } = await supabase
    .from("token_balances")
    .upsert({ user_id: params.userId, balance: newBalance }, { onConflict: "user_id" });

  if (balError) throw balError;

  return newBalance;
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
