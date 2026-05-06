import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type TeamRow = Tables<"teams">;
export type ProjectRow = Tables<"projects">;
export type BlogRow = Tables<"blogs">;

/** URL-safe slug; falls back to `fallback` when empty */
export function slugify(input: string, fallback: string): string {
  const s = input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

export async function generateUniqueTeamSlug(baseName: string, client: Client): Promise<string> {
  let slug = slugify(baseName, "team");
  for (let i = 0; i < 8; i++) {
    const { data } = await client.from("teams").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
    slug = `${slugify(baseName, "team")}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${slugify(baseName, "team")}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function generateUniqueProjectSlug(
  teamId: string,
  baseName: string,
  client: Client,
): Promise<string> {
  let slug = slugify(baseName, "project");
  for (let i = 0; i < 8; i++) {
    const { data } = await client
      .from("projects")
      .select("id")
      .eq("team_id", teamId)
      .eq("slug", slug)
      .maybeSingle();
    if (!data) return slug;
    slug = `${slugify(baseName, "project")}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${slugify(baseName, "project")}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function generateUniqueBlogSlug(
  projectId: string,
  baseName: string,
  client: Client,
): Promise<string> {
  let slug = slugify(baseName, "blog");
  for (let i = 0; i < 8; i++) {
    const { data } = await client
      .from("blogs")
      .select("id")
      .eq("project_id", projectId)
      .eq("slug", slug)
      .maybeSingle();
    if (!data) return slug;
    slug = `${slugify(baseName, "blog")}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${slugify(baseName, "blog")}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function listTeamsForUser(userId: string, client: Client): Promise<TeamRow[]> {
  const { data: memberships, error: mErr } = await client
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);

  if (mErr) throw mErr;
  const teamIds = [...new Set((memberships ?? []).map((m) => m.team_id))];
  if (teamIds.length === 0) return [];

  const { data: teams, error: tErr } = await client.from("teams").select("*").in("id", teamIds);

  if (tErr) throw tErr;
  return teams ?? [];
}

export async function listProjectsForTeam(teamId: string, client: Client): Promise<ProjectRow[]> {
  const { data, error } = await client
    .from("projects")
    .select("*")
    .eq("team_id", teamId)
    .order("name");

  if (error) throw error;
  return data ?? [];
}

export async function listBlogsForProject(projectId: string, client: Client): Promise<BlogRow[]> {
  const { data, error } = await client
    .from("blogs")
    .select("*")
    .eq("project_id", projectId)
    .order("name");

  if (error) throw error;
  return data ?? [];
}

export async function createTeamWithOwner(input: {
  name: string;
  userId: string;
  client: Client;
}): Promise<TeamRow> {
  const slug = await generateUniqueTeamSlug(input.name, input.client);

  const teamInsert: TablesInsert<"teams"> = {
    name: input.name.trim(),
    slug,
    created_by: input.userId,
  };

  const { data: team, error: teamErr } = await input.client
    .from("teams")
    .insert(teamInsert)
    .select()
    .single();

  if (teamErr) throw teamErr;

  const { error: memErr } = await input.client.from("team_members").insert({
    team_id: team.id,
    user_id: input.userId,
    role: "owner",
  });

  if (memErr) throw memErr;

  return team;
}
