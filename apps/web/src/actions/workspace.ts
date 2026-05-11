"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Json,
  TablesInsert,
  TablesUpdate,
} from "@/lib/supabase/database.types";
import {
  type BlogSettings,
  loadBlogSettings,
  mergeBlogSettings,
} from "@/lib/blog-settings";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import {
  type ArticleListRow,
  createTeamWithOwner,
  generateUniqueBlogSlug,
  generateUniqueProjectSlug,
  generateUniqueTeamSlug,
  listBlogsForProject,
  listPostsForBlog,
  listProjectsForTeam,
  listTeamsForUser,
} from "@/services/workspace-service";

export type ActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function createTeam(
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { data: null, error: "Team name is required." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const team = await createTeamWithOwner({
      name: trimmed,
      userId: user.id,
      client: supabase,
    });
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
    const message =
      e instanceof Error ? e.message : "Could not create project.";
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
    return {
      data: null,
      error: `Description must be at most ${MAX_PROJECT_DESCRIPTION} characters.`,
    };
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
      const message =
        e instanceof Error ? e.message : "Could not update project slug.";
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
    return {
      data: null,
      error: `Description must be at most ${MAX_PROJECT_DESCRIPTION} characters.`,
    };
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

  return updateProjectSettings(teamId, projectId, {
    name: row.name,
    description,
  });
}

/**
 * Name is the only required field. WordPress connection details are now opt-in
 * — users wire those up later from the blog's settings page. If any one of
 * the three WP fields is provided, all three must be present (we treat them
 * as a single credential bundle).
 */
export type CreateBlogInput = {
  projectId: string;
  teamId: string;
  name: string;
  wpUrl?: string;
  wpUsername?: string;
  wpAppPassword?: string;
};

export async function createBlog(
  input: CreateBlogInput,
): Promise<ActionResult<{ id: string }>> {
  const name = input.name.trim();
  if (!name) {
    return { data: null, error: "Blog name is required." };
  }

  const wpUrl = input.wpUrl?.trim() ?? "";
  const wpUsername = input.wpUsername?.trim() ?? "";
  const wpAppPassword = input.wpAppPassword?.trim() ?? "";
  const anyWp = Boolean(wpUrl || wpUsername || wpAppPassword);
  const allWp = Boolean(wpUrl && wpUsername && wpAppPassword);
  if (anyWp && !allWp) {
    return {
      data: null,
      error:
        "WordPress URL, username, and application password are all required when connecting a site.",
    };
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
      wp_url: allWp ? wpUrl : null,
      wp_username: allWp ? wpUsername : null,
      wp_app_password: allWp ? wpAppPassword : null,
    };

    const { data, error } = await supabase
      .from("blogs")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    revalidatePath(`/teams/${input.teamId}/projects/${input.projectId}/blogs`);
    revalidatePath(
      `/teams/${input.teamId}/projects/${input.projectId}/blogs/${data.id}`,
    );
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

export async function updateTeam(
  teamId: string,
  input: { name: string },
): Promise<ActionResult<null>> {
  const name = input.name.trim();
  if (!name) {
    return { data: null, error: "Team name is required." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "update_team", admin);

    const { data: existing } = await admin
      .from("teams")
      .select("name, slug")
      .eq("id", teamId)
      .maybeSingle();

    if (!existing) {
      return { data: null, error: "Team not found." };
    }

    let slug = existing.slug;
    if (name !== existing.name.trim()) {
      slug = await generateUniqueTeamSlug(name, supabase);
    }

    const { error } = await admin
      .from("teams")
      .update({ name, slug })
      .eq("id", teamId);
    if (error) return { data: null, error: error.message };

    revalidatePath(`/teams/${teamId}/settings`);
    revalidatePath(`/teams/${teamId}/projects`);
    revalidatePath("/teams");
    revalidatePath("/dashboard");
    return { data: null, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError)
      return { data: null, error: err.code };
    return {
      data: null,
      error: err instanceof Error ? err.message : "Could not rename team.",
    };
  }
}

export async function deleteTeam(
  teamId: string,
): Promise<ActionResult<{ redirect: string }>> {
  const { user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "delete_team", admin);

    // Delete in FK-safe order: invites → members → blogs → projects → team
    await admin.from("team_invites").delete().eq("team_id", teamId);
    await admin.from("team_members").delete().eq("team_id", teamId);

    const { data: projectRows } = await admin
      .from("projects")
      .select("id")
      .eq("team_id", teamId);

    const projectIds = (projectRows ?? []).map((p) => p.id);
    if (projectIds.length > 0) {
      await admin.from("blogs").delete().in("project_id", projectIds);
      await admin.from("projects").delete().in("id", projectIds);
    }

    const { error } = await admin.from("teams").delete().eq("id", teamId);
    if (error) return { data: null, error: error.message };

    revalidatePath("/teams");
    revalidatePath("/dashboard");
    return { data: { redirect: "/teams" }, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError)
      return { data: null, error: err.code };
    return {
      data: null,
      error: err instanceof Error ? err.message : "Could not delete team.",
    };
  }
}

export async function deleteProject(
  teamId: string,
  projectId: string,
): Promise<ActionResult<{ redirect: string }>> {
  const { user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "delete_project", admin);

    await admin.from("blogs").delete().eq("project_id", projectId);
    const { error } = await admin
      .from("projects")
      .delete()
      .eq("id", projectId)
      .eq("team_id", teamId);

    if (error) return { data: null, error: error.message };

    revalidatePath(`/teams/${teamId}/projects`);
    revalidatePath("/dashboard");
    return { data: { redirect: `/teams/${teamId}/projects` }, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError)
      return { data: null, error: err.code };
    return {
      data: null,
      error: err instanceof Error ? err.message : "Could not delete project.",
    };
  }
}

const MAX_BLOG_DESCRIPTION = 1000;
const MAX_AI_PROMPT = 8000;
const MAX_KEYWORDS = 50;

/**
 * Connection bundle for the WordPress (or future CMS) connection card.
 *
 * Three semantics for `wpAppPassword`:
 *   • non-empty string → set / replace the stored password
 *   • `""` (empty)     → preserve the existing stored password (used when
 *                        the user only wants to tweak the URL or username)
 *   • `null`           → disconnect; URL and username should also be null
 *
 * Migration 00014 enforces "all three together OR all three null" as a soft
 * business rule; the action validates this below.
 */
export type BlogConnectionInput = {
  /** Site root URL ("https://example.com"). Pass `null` to disconnect. */
  wpUrl: string | null;
  /** REST username. */
  wpUsername: string | null;
  /** Application password. See class comment for `""` semantics. */
  wpAppPassword: string | null;
};

/**
 * Full payload for the redesigned blog settings UI. Everything is optional;
 * callers send only the fields they want to update. `settings` is a section
 * patch that's merged into the existing jsonb (see {@link mergeBlogSettings}).
 *
 * Note: legacy `articlesPerDay`, `scheduleCron`, and `isActive` fields were
 * removed in migration 00018. The new equivalents live under
 * `settings.automation` (`generatePerWeek`, `enabled`, etc.).
 */
export type UpdateBlogInput = {
  name?: string;
  description?: string;
  niche?: string;
  keywords?: string[];
  aiPromptTemplate?: string;
  /** Shallow-merged into `blogs.settings`. */
  settings?: Partial<{
    [K in keyof BlogSettings]: Partial<BlogSettings[K]>;
  }>;
  /** Pass to update WordPress connection (or pass nulls to disconnect). */
  connection?: BlogConnectionInput;
};

/**
 * Validate an IANA timezone string by asking the platform to parse it.
 * `Intl.DateTimeFormat` throws `RangeError` for unknown zones — the cheapest
 * cross-runtime way to validate without bundling a tz database.
 */
function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function normalizeKeywords(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const k = String(raw).trim();
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

export async function updateBlog(
  teamId: string,
  projectId: string,
  blogId: string,
  input: UpdateBlogInput,
): Promise<ActionResult<null>> {
  const trimmedName =
    typeof input.name === "string" ? input.name.trim() : undefined;
  if (input.name !== undefined && !trimmedName) {
    return { data: null, error: "Blog name is required." };
  }

  if (
    typeof input.description === "string" &&
    input.description.length > MAX_BLOG_DESCRIPTION
  ) {
    return {
      data: null,
      error: `Description must be at most ${MAX_BLOG_DESCRIPTION} characters.`,
    };
  }

  if (
    typeof input.aiPromptTemplate === "string" &&
    input.aiPromptTemplate.length > MAX_AI_PROMPT
  ) {
    return {
      data: null,
      error: `AI prompt template must be at most ${MAX_AI_PROMPT} characters.`,
    };
  }

  if (input.settings?.automation) {
    const auto = input.settings.automation;
    if (typeof auto.timezone === "string" && auto.timezone.trim()) {
      if (!isValidIanaTimezone(auto.timezone.trim())) {
        return {
          data: null,
          error: `Unknown timezone "${auto.timezone}". Use an IANA timezone name (e.g. Etc/UTC, America/New_York).`,
        };
      }
    }
    if (
      typeof auto.generatePerWeek === "number" &&
      (!Number.isFinite(auto.generatePerWeek) ||
        auto.generatePerWeek < 0 ||
        auto.generatePerWeek > 100)
    ) {
      return {
        data: null,
        error: "Generate per week must be between 0 and 100.",
      };
    }
    if (
      typeof auto.backlogThreshold === "number" &&
      (!Number.isFinite(auto.backlogThreshold) ||
        auto.backlogThreshold < 0 ||
        auto.backlogThreshold > 1000)
    ) {
      return {
        data: null,
        error: "Backlog threshold must be between 0 and 1000.",
      };
    }
    if (
      auto.dailyTokenBudget !== undefined &&
      auto.dailyTokenBudget !== null &&
      (typeof auto.dailyTokenBudget !== "number" ||
        !Number.isFinite(auto.dailyTokenBudget) ||
        auto.dailyTokenBudget < 0)
    ) {
      return {
        data: null,
        error:
          "Daily token budget must be 0 or higher, or blank for no per-blog cap.",
      };
    }
  }

  if (input.connection) {
    const { wpUrl, wpUsername, wpAppPassword } = input.connection;
    const isClearing =
      wpUrl === null && wpUsername === null && wpAppPassword === null;
    const urlAndUserSet = Boolean(
      typeof wpUrl === "string" &&
      wpUrl.trim() &&
      typeof wpUsername === "string" &&
      wpUsername.trim(),
    );
    // Empty string for the password means "preserve existing"; we'll validate
    // below that an existing password is on file.
    const passwordOk =
      (typeof wpAppPassword === "string" && wpAppPassword.trim()) ||
      wpAppPassword === "";
    if (!isClearing && !(urlAndUserSet && passwordOk)) {
      return {
        data: null,
        error:
          "WordPress URL, username, and application password are all required when connecting a site.",
      };
    }
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "manage_blog", admin);

    const { data: existing } = await supabase
      .from("blogs")
      .select("name, slug, settings, wp_app_password")
      .eq("id", blogId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (!existing) {
      return { data: null, error: "Blog not found." };
    }

    const update: TablesUpdate<"blogs"> = {};

    if (trimmedName) {
      update.name = trimmedName;
      if (trimmedName !== existing.name.trim()) {
        update.slug = await generateUniqueBlogSlug(
          projectId,
          trimmedName,
          supabase,
        );
      }
    }

    if (typeof input.description === "string") {
      update.description = input.description.trim();
    }
    if (typeof input.niche === "string") {
      update.niche = input.niche.trim();
    }
    if (Array.isArray(input.keywords)) {
      update.keywords = normalizeKeywords(input.keywords);
    }
    if (typeof input.aiPromptTemplate === "string") {
      update.ai_prompt_template = input.aiPromptTemplate;
    }

    if (input.settings) {
      const current = loadBlogSettings(existing.settings as Json);
      const next = mergeBlogSettings(current, input.settings);
      // When the user re-enables autopilot via the settings save flow,
      // clear the auto-pause metadata so the warning banner disappears
      // and recent-runs panel goes back to the normal "armed" state.
      // The user toggling Enabled is a fresh acknowledgment of the
      // failed runs, so it's safe to wipe.
      if (
        input.settings.automation?.enabled === true &&
        (next.automation.pausedReason !== null ||
          next.automation.pausedAt !== null ||
          next.automation.pausedMessage !== null)
      ) {
        next.automation = {
          ...next.automation,
          pausedReason: null,
          pausedAt: null,
          pausedMessage: null,
        };
      }
      update.settings = next as unknown as Json;
    }

    if (input.connection) {
      const { wpUrl, wpUsername, wpAppPassword } = input.connection;
      update.wp_url = wpUrl;
      update.wp_username = wpUsername;
      if (wpAppPassword === "") {
        // Preserve existing password — only valid if one is already stored.
        if (!existing.wp_app_password) {
          return {
            data: null,
            error:
              "Application password is required to connect a WordPress site.",
          };
        }
      } else {
        update.wp_app_password = wpAppPassword;
      }
    }

    if (Object.keys(update).length === 0) {
      return { data: null, error: null };
    }

    const { error } = await supabase
      .from("blogs")
      .update(update)
      .eq("id", blogId)
      .eq("project_id", projectId);

    if (error) return { data: null, error: error.message };

    revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs/${blogId}`);
    revalidatePath(
      `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/settings`,
    );
    revalidatePath(
      `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/connections`,
    );
    revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs`);
    revalidatePath(`/teams/${teamId}/projects/${projectId}`);
    return { data: null, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError)
      return { data: null, error: err.code };
    return {
      data: null,
      error: err instanceof Error ? err.message : "Could not update blog.",
    };
  }
}

export async function getPostsForBlog(
  teamId: string,
  projectId: string,
  blogId: string,
): Promise<ActionResult<ArticleListRow[]>> {
  const { supabase, user } = await requireUser();
  if (!user) return { data: null, error: "You must be signed in." };

  try {
    const { data: blog, error: blogErr } = await supabase
      .from("blogs")
      .select("id")
      .eq("id", blogId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (blogErr || !blog) {
      // Make sure callers get a helpful message even when RLS hides the row.
      void teamId;
      return { data: null, error: "Blog not found." };
    }

    const posts = await listPostsForBlog(blogId, supabase);
    return { data: posts, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Could not load posts.",
    };
  }
}

const MAX_POST_TITLE = 200;

export async function createPost(
  teamId: string,
  projectId: string,
  blogId: string,
  input: { title: string; targetKeyword?: string; authorPersona?: string },
): Promise<ActionResult<{ id: string }>> {
  const title = input.title.trim();
  if (!title) {
    return { data: null, error: "Post title is required." };
  }
  if (title.length > MAX_POST_TITLE) {
    return {
      data: null,
      error: `Title must be at most ${MAX_POST_TITLE} characters.`,
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { data: null, error: "You must be signed in." };

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "manage_blog", admin);

    const { data: blog } = await supabase
      .from("blogs")
      .select("id")
      .eq("id", blogId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (!blog) {
      return { data: null, error: "Blog not found." };
    }

    const row: TablesInsert<"articles"> = {
      blog_id: blogId,
      title,
      target_keyword: input.targetKeyword?.trim() || null,
      author_persona: input.authorPersona?.trim() || null,
      status: "draft",
    };

    const { data, error } = await supabase
      .from("articles")
      .insert(row)
      .select("id")
      .single();

    if (error) return { data: null, error: error.message };

    revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs/${blogId}`);
    return { data: { id: data.id }, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError)
      return { data: null, error: err.code };
    return {
      data: null,
      error: err instanceof Error ? err.message : "Could not create post.",
    };
  }
}

export async function deleteBlog(
  teamId: string,
  projectId: string,
  blogId: string,
): Promise<ActionResult<{ redirect: string }>> {
  const { user } = await requireUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "manage_blog", admin);

    const { error } = await admin
      .from("blogs")
      .delete()
      .eq("id", blogId)
      .eq("project_id", projectId);

    if (error) return { data: null, error: error.message };

    revalidatePath(`/teams/${teamId}/projects/${projectId}/blogs`);
    revalidatePath(`/teams/${teamId}/projects/${projectId}`);
    return {
      data: { redirect: `/teams/${teamId}/projects/${projectId}/blogs` },
      error: null,
    };
  } catch (err) {
    if (err instanceof TeamPermissionError)
      return { data: null, error: err.code };
    return {
      data: null,
      error: err instanceof Error ? err.message : "Could not delete blog.",
    };
  }
}
