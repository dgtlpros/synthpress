"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/supabase/database.types";
import {
  createTeamWithOwner,
  generateUniqueBlogSlug,
  generateUniqueProjectSlug,
  listBlogsForProject,
  listProjectsForTeam,
  listTeamsForUser,
} from "@/services/workspace-service";

export type ActionResult<T> = { data: T; error: null } | { data: null; error: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function createTeam(name: string): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { data: null, error: "Team name is required." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const team = await createTeamWithOwner({ name: trimmed, userId: user.id, client: supabase });
    revalidatePath("/teams");
    revalidatePath("/dashboard");
    return { data: { id: team.id }, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create team.";
    return { data: null, error: message };
  }
}

export async function createWorkspaceProject(
  teamId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { data: null, error: "Project name is required." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const slug = await generateUniqueProjectSlug(teamId, trimmed, supabase);
    const { data, error } = await supabase
      .from("projects")
      .insert({ team_id: teamId, name: trimmed, slug })
      .select("id")
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    revalidatePath(`/teams/${teamId}/projects`);
    revalidatePath(`/teams/${teamId}/projects/${data.id}`);
    revalidatePath("/dashboard");
    return { data: { id: data.id }, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create project.";
    return { data: null, error: message };
  }
}

const MAX_PROJECT_DESCRIPTION = 5000;

export async function updateProjectSettings(
  teamId: string,
  projectId: string,
  input: { name: string; description: string },
): Promise<ActionResult<null>> {
  const name = input.name.trim();
  if (!name) {
    return { data: null, error: "Project name is required." };
  }
  if (input.description.length > MAX_PROJECT_DESCRIPTION) {
    return { data: null, error: `Description must be at most ${MAX_PROJECT_DESCRIPTION} characters.` };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  const { data: row, error: fetchErr } = await supabase
    .from("projects")
    .select("name, slug")
    .eq("id", projectId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (fetchErr || !row) {
    return { data: null, error: "Project not found." };
  }

  let slug = row.slug;
  if (name !== row.name.trim()) {
    try {
      slug = await generateUniqueProjectSlug(teamId, name, supabase);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not update project slug.";
      return { data: null, error: message };
    }
  }

  const trimmedDesc = input.description.trim();
  const { error } = await supabase
    .from("projects")
    .update({ name, description: trimmedDesc, slug })
    .eq("id", projectId)
    .eq("team_id", teamId);

  if (error) {
    return { data: null, error: error.message };
  }

  revalidatePath(`/teams/${teamId}/projects/${projectId}`);
  revalidatePath(`/teams/${teamId}/projects`);
  revalidatePath("/dashboard");
  return { data: null, error: null };
}

export async function updateProjectDescription(
  teamId: string,
  projectId: string,
  description: string,
): Promise<ActionResult<null>> {
  if (description.length > MAX_PROJECT_DESCRIPTION) {
    return { data: null, error: `Description must be at most ${MAX_PROJECT_DESCRIPTION} characters.` };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  const { data: row, error: fetchErr } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (fetchErr || !row) {
    return { data: null, error: "Project not found." };
  }

  return updateProjectSettings(teamId, projectId, { name: row.name, description });
}

export type CreateBlogInput = {
  projectId: string;
  teamId: string;
  name: string;
  wpUrl: string;
  wpUsername: string;
  wpAppPassword: string;
};

export async function createBlog(input: CreateBlogInput): Promise<ActionResult<{ id: string }>> {
  const name = input.name.trim();
  if (!name) {
    return { data: null, error: "Blog name is required." };
  }
  const wpUrl = input.wpUrl.trim();
  const wpUsername = input.wpUsername.trim();
  const wpAppPassword = input.wpAppPassword.trim();
  if (!wpUrl || !wpUsername || !wpAppPassword) {
    return { data: null, error: "WordPress URL, username, and application password are required." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const slug = await generateUniqueBlogSlug(input.projectId, name, supabase);
    const row: TablesInsert<"blogs"> = {
      project_id: input.projectId,
      name,
      slug,
      wp_url: wpUrl,
      wp_username: wpUsername,
      wp_app_password: wpAppPassword,
    };

    const { data, error } = await supabase.from("blogs").insert(row).select("id").single();

    if (error) {
      return { data: null, error: error.message };
    }

    revalidatePath(`/teams/${input.teamId}/projects/${input.projectId}/blogs`);
    revalidatePath(`/teams/${input.teamId}/projects/${input.projectId}/blogs/${data.id}`);
    revalidatePath(`/teams/${input.teamId}/projects/${input.projectId}`);
    revalidatePath("/dashboard");
    return { data: { id: data.id }, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create blog.";
    return { data: null, error: message };
  }
}

export async function getTeamsForCurrentUser() {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }
  try {
    const teams = await listTeamsForUser(user.id, supabase);
    return { data: teams, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load teams.";
    return { data: null, error: message };
  }
}

export async function getProjectsForTeam(teamId: string) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }
  try {
    const projects = await listProjectsForTeam(teamId, supabase);
    return { data: projects, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load projects.";
    return { data: null, error: message };
  }
}

export async function getBlogsForProject(projectId: string) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }
  try {
    const blogs = await listBlogsForProject(projectId, supabase);
    return { data: blogs, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load blogs.";
    return { data: null, error: message };
  }
}
