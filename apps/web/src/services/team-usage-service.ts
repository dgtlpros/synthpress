import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

type Client = SupabaseClient<Database>;

export type TokenTransaction = Tables<"token_transactions">;

export interface TeamUsageRow {
  id: string;
  amount: number;
  description: string | null;
  created_at: string;
  type: string;
  team_id: string;
  project_id: string | null;
  blog_id: string | null;
  acting_user_id: string | null;
  project_name: string | null;
  blog_name: string | null;
  acting_user_name: string | null;
}

export interface TeamUsageSummary {
  totalSpent: number;
  totalTransactions: number;
  byMember: {
    actingUserId: string;
    actingUserName: string | null;
    spent: number;
    count: number;
  }[];
  byProject: {
    projectId: string;
    projectName: string | null;
    spent: number;
    count: number;
  }[];
  byDay: { day: string; spent: number; count: number }[];
}

export interface TeamUsageResult {
  rows: TeamUsageRow[];
  summary: TeamUsageSummary;
}

/** Pull a string value from a JSON metadata blob without losing types. */
function metaString(
  meta: TokenTransaction["metadata"],
  key: string,
): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Loads team-scoped usage transactions and joins to project / blog / member
 * names in a single batch (3 follow-up queries by id-set).
 *
 * Performs:
 *   1. Select token_transactions with metadata->>'team_id' = teamId
 *   2. Collect distinct project_id, blog_id, acting_user_id sets from the
 *      JSON metadata
 *   3. Resolve names for each via projects, blogs, profiles
 *   4. Build a flat usage row + per-member / per-project / per-day summaries
 *
 * Service-role only client expected (admin); RLS on token_transactions
 * default-denies authenticated reads.
 */
export async function getTeamUsage(args: {
  teamId: string;
  limit?: number;
  client?: Client;
}): Promise<TeamUsageResult> {
  const supabase = args.client ?? createAdminClient();
  const limit = args.limit ?? 200;

  const { data: txRows, error } = await supabase
    .from("token_transactions")
    .select("id, amount, description, created_at, type, metadata")
    .eq("type", "usage")
    .eq("metadata->>team_id", args.teamId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const txs = (txRows ?? []) as Pick<
    TokenTransaction,
    "id" | "amount" | "description" | "created_at" | "type" | "metadata"
  >[];

  const projectIds = new Set<string>();
  const blogIds = new Set<string>();
  const userIds = new Set<string>();

  for (const t of txs) {
    const p = metaString(t.metadata, "project_id");
    const b = metaString(t.metadata, "blog_id");
    const u = metaString(t.metadata, "acting_user_id");
    if (p) projectIds.add(p);
    if (b) blogIds.add(b);
    if (u) userIds.add(u);
  }

  const [projectsRes, blogsRes, profilesRes] = await Promise.all([
    projectIds.size > 0
      ? supabase
          .from("projects")
          .select("id, name")
          .in("id", Array.from(projectIds))
      : Promise.resolve({ data: [], error: null }),
    blogIds.size > 0
      ? supabase.from("blogs").select("id, name").in("id", Array.from(blogIds))
      : Promise.resolve({ data: [], error: null }),
    userIds.size > 0
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", Array.from(userIds))
      : Promise.resolve({ data: [], error: null }),
  ]);

  const projectName = new Map<string, string>(
    (projectsRes.data ?? []).map((p) => [p.id as string, p.name as string]),
  );
  const blogName = new Map<string, string>(
    (blogsRes.data ?? []).map((b) => [b.id as string, b.name as string]),
  );
  const userName = new Map<string, string | null>(
    /* v8 ignore next */
    (profilesRes.data ?? []).map((p) => [
      p.id as string,
      (p.full_name as string | null) ?? null,
    ]),
  );

  const rows: TeamUsageRow[] = txs.map((t) => {
    const project_id = metaString(t.metadata, "project_id");
    const blog_id = metaString(t.metadata, "blog_id");
    const acting_user_id = metaString(t.metadata, "acting_user_id");
    return {
      id: t.id,
      amount: t.amount,
      description: t.description,
      created_at: t.created_at,
      type: t.type,
      team_id: args.teamId,
      project_id,
      blog_id,
      acting_user_id,
      project_name: project_id ? (projectName.get(project_id) ?? null) : null,
      blog_name: blog_id ? (blogName.get(blog_id) ?? null) : null,
      acting_user_name: acting_user_id
        ? (userName.get(acting_user_id) ?? null)
        : null,
    };
  });

  const totalSpent = rows.reduce((acc, r) => acc + Math.abs(r.amount), 0);

  const byMemberMap = new Map<
    string,
    { spent: number; count: number; name: string | null }
  >();
  const byProjectMap = new Map<
    string,
    { spent: number; count: number; name: string | null }
  >();
  const byDayMap = new Map<string, { spent: number; count: number }>();

  for (const r of rows) {
    const spent = Math.abs(r.amount);

    const memberKey = r.acting_user_id ?? "__unknown__";
    const m = byMemberMap.get(memberKey) ?? {
      spent: 0,
      count: 0,
      name: r.acting_user_name,
    };
    m.spent += spent;
    m.count += 1;
    if (!m.name) m.name = r.acting_user_name;
    byMemberMap.set(memberKey, m);

    const projectKey = r.project_id ?? "__none__";
    const p = byProjectMap.get(projectKey) ?? {
      spent: 0,
      count: 0,
      name: r.project_name,
    };
    p.spent += spent;
    p.count += 1;
    if (!p.name) p.name = r.project_name;
    byProjectMap.set(projectKey, p);

    const day = dayKey(r.created_at);
    const d = byDayMap.get(day) ?? { spent: 0, count: 0 };
    d.spent += spent;
    d.count += 1;
    byDayMap.set(day, d);
  }

  const byMember = Array.from(byMemberMap.entries())
    .map(([actingUserId, v]) => ({
      actingUserId,
      actingUserName: v.name,
      spent: v.spent,
      count: v.count,
    }))
    .sort((a, b) => b.spent - a.spent);

  const byProject = Array.from(byProjectMap.entries())
    .map(([projectId, v]) => ({
      projectId,
      projectName: v.name,
      spent: v.spent,
      count: v.count,
    }))
    .sort((a, b) => b.spent - a.spent);

  const byDay = Array.from(byDayMap.entries())
    .map(([day, v]) => ({ day, spent: v.spent, count: v.count }))
    .sort(/* v8 ignore next */ (a, b) => (a.day < b.day ? 1 : -1));

  return {
    rows,
    summary: {
      totalSpent,
      totalTransactions: rows.length,
      byMember,
      byProject,
      byDay,
    },
  };
}
