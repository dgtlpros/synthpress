"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertCan,
  TeamPermissionError,
} from "@/services/team-policy-service";
import {
  consumeTeamTokens as consumeTeamTokensService,
  getTeamPlan as getTeamPlanService,
  type TeamBillingContext,
} from "@/services/team-billing-service";

export interface ConsumeTeamTokensInput {
  teamId: string;
  amount: number;
  description?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export type ConsumeTeamTokensResult =
  | { balance: number; error: null }
  | { balance: null; error: string };

/**
 * Server action: consumes tokens against a team's billing user (the owner).
 * The caller (auth user) is recorded as `acting_user_id` in the audit row.
 *
 * Permission: any team member may trigger a team-scoped consume; the debit
 * still hits the owner's balance regardless of who triggered it. Members
 * who are not on the team get a typed permission error.
 */
export async function consumeTeamTokens(
  input: ConsumeTeamTokensInput,
): Promise<ConsumeTeamTokensResult> {
  if (!input.teamId) {
    return { balance: null, error: "teamId is required" };
  }
  if (!input.amount || input.amount <= 0) {
    return { balance: null, error: "amount_must_be_positive" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { balance: null, error: "Not signed in" };
  }

  try {
    const admin = createAdminClient();
    await assertCan(input.teamId, user.id, "consume_team_tokens", admin);

    const balance = await consumeTeamTokensService({
      teamId: input.teamId,
      amount: input.amount,
      actingUserId: user.id,
      description: input.description,
      metadata: input.metadata,
      idempotencyKey: input.idempotencyKey,
      client: admin,
    });

    return { balance, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { balance: null, error: err.code };
    }
    if (err instanceof Error) {
      if (
        err.message === "insufficient_tokens" ||
        err.message === "team_has_no_billing_user" ||
        err.message === "amount_must_be_positive"
      ) {
        return { balance: null, error: err.message };
      }
      return { balance: null, error: err.message };
    }
    return { balance: null, error: "Failed to consume tokens" };
  }
}

export type GetTeamBillingResult =
  | { plan: TeamBillingContext; error: null }
  | { plan: null; error: string };

/**
 * Server action: returns the team's billing context (owner id, plan, status,
 * balance). Only members may call this.
 */
export async function getTeamBilling(teamId: string): Promise<GetTeamBillingResult> {
  if (!teamId) {
    return { plan: null, error: "teamId is required" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { plan: null, error: "Not signed in" };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "consume_team_tokens", admin);

    const plan = await getTeamPlanService(teamId, admin);
    if (!plan) {
      return { plan: null, error: "team_not_found" };
    }
    return { plan, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { plan: null, error: err.code };
    }
    return {
      plan: null,
      error: err instanceof Error ? err.message : "Failed to load team billing",
    };
  }
}
