"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBlogSettings } from "@/lib/blog-settings";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import {
  type RunAutopilotForBlogResult,
  runAutopilotForBlog,
} from "@/services/autopilot-scheduler-service";
import {
  type BlogAutopilotRunDetail,
  getBlogAutopilotRunDetail,
} from "@/services/blog-autopilot-run-service";
import type { ActionResult } from "./workspace";

/**
 * Manual "Run Autopilot Now" — same scheduler the cron route calls,
 * but kicked by a user clicking the button on the blog settings page.
 *
 * Why we GATE on `mode='autopilot' AND enabled=true` instead of
 * letting the scheduler short-circuit:
 *   The scheduler's "skipped because autopilot disabled" path still
 *   creates a `blog_autopilot_runs` row for audit. That's the right
 *   behavior for the cron path (so an operator can confirm the
 *   scheduler did run and chose not to act). But for a manual click
 *   it's noisy — a user testing their config would see a stream of
 *   skipped audit rows from misclicks. The action returns a friendly
 *   error before creating the row in that case, and the panel shows
 *   the error inline.
 *
 * Permission model: `manage_blog`. The same gate the per-blog
 * settings tabs use — anyone allowed to flip autopilot on can also
 * flip it on AND immediately verify it works.
 */
export interface RunAutopilotNowResult {
  runId: string;
  status: RunAutopilotForBlogResult["status"];
  reason: string | null;
  ideasGenerated: number;
  articleJobsStarted: number;
}

/**
 * Errors we surface as `result.error`. UI maps these to friendly
 * copy so the wording can change without touching the action.
 */
export const AUTOPILOT_ACTION_ERRORS = {
  not_signed_in: "You must be signed in.",
  blog_not_found: "Blog not found.",
  autopilot_disabled:
    "Enable autopilot first. Open the Automation tab, set Mode to Autopilot and turn on the Enabled toggle.",
} as const;

export async function runAutopilotNow(
  teamId: string,
  projectId: string,
  blogId: string,
): Promise<ActionResult<RunAutopilotNowResult>> {
  if (!blogId) {
    return { data: null, error: "Blog id is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { data: null, error: AUTOPILOT_ACTION_ERRORS.not_signed_in };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "manage_blog", admin);

    // Confirm the blog belongs to the project AND check the
    // settings up-front so we can short-circuit cleanly without
    // burning an audit row.
    const { data: blog } = await admin
      .from("blogs")
      .select("id, settings")
      .eq("id", blogId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!blog) {
      return { data: null, error: AUTOPILOT_ACTION_ERRORS.blog_not_found };
    }

    const automation = loadBlogSettings(blog.settings).automation;
    if (automation.mode !== "autopilot" || !automation.enabled) {
      return {
        data: null,
        error: AUTOPILOT_ACTION_ERRORS.autopilot_disabled,
      };
    }

    const result = await runAutopilotForBlog({
      teamId,
      projectId,
      blogId,
      triggeredByUserId: user.id,
      triggerSource: "manual",
      client: admin,
    });

    revalidatePath(
      `/teams/${teamId}/projects/${projectId}/blogs/${blogId}/settings`,
    );

    return {
      data: {
        runId: result.runId,
        status: result.status,
        reason: result.reason,
        ideasGenerated: result.ideasGenerated,
        articleJobsStarted: result.articleJobsStarted,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { data: null, error: err.code };
    }
    const message =
      err instanceof Error ? err.message : "Could not run autopilot.";
    return { data: null, error: message };
  }
}

/**
 * Loads the full audit detail for one autopilot run — what the
 * recent-runs drawer renders. Same `manage_blog` permission gate
 * the panel itself uses, so anyone who can see the panel can
 * inspect any of its rows.
 *
 * Returns:
 *   * `data: <detail>` on success
 *   * `data: null, error: "Run not found."` when the run id /
 *     blog id pair doesn't resolve. We use the same wording for
 *     "doesn't exist" and "exists but belongs to another team" to
 *     avoid leaking row existence across the team boundary.
 */
export async function getAutopilotRunDetail(
  teamId: string,
  projectId: string,
  blogId: string,
  runId: string,
): Promise<ActionResult<BlogAutopilotRunDetail>> {
  if (!blogId || !runId) {
    return { data: null, error: "Blog and run ids are required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { data: null, error: AUTOPILOT_ACTION_ERRORS.not_signed_in };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "manage_blog", admin);

    // Confirm the blog actually belongs to the project — the action
    // is callable from any client with team membership, so we
    // re-bind the blog→project link before the detail query trusts
    // `blogId`.
    const { data: blog } = await admin
      .from("blogs")
      .select("id")
      .eq("id", blogId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!blog) {
      return { data: null, error: AUTOPILOT_ACTION_ERRORS.blog_not_found };
    }

    const detail = await getBlogAutopilotRunDetail({
      blogId,
      runId,
      client: admin,
    });
    if (!detail) {
      return { data: null, error: "Run not found." };
    }

    return { data: detail, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { data: null, error: err.code };
    }
    const message =
      err instanceof Error ? err.message : "Could not load run details.";
    return { data: null, error: message };
  }
}
