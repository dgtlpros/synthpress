"use server";

import { createClient } from "@/lib/supabase/server";
import {
  consumeTokens as consumeTokensService,
  getBalance,
  getRecentTransactions,
  type TokenTransaction,
} from "@/services/token-service";

export interface BalanceResult {
  balance?: number;
  error?: string;
}

export interface ConsumeResult {
  balance?: number;
  error?: string;
}

export interface TransactionsResult {
  transactions?: TokenTransaction[];
  error?: string;
}

export async function getTokenBalance(): Promise<BalanceResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    const balance = await getBalance(user.id);
    return { balance };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load balance" };
  }
}

export async function consumeTokens(amount: number, description?: string): Promise<ConsumeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    const balance = await consumeTokensService({
      userId: user.id,
      amount,
      description,
    });
    return { balance };
  } catch (err) {
    if (err instanceof Error && err.message === "insufficient_tokens") {
      return { error: "insufficient_tokens" };
    }
    return { error: err instanceof Error ? err.message : "Failed to consume tokens" };
  }
}

export async function getTokenTransactions(limit = 10): Promise<TransactionsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    const transactions = await getRecentTransactions(user.id, { limit });
    return { transactions };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load transactions" };
  }
}
