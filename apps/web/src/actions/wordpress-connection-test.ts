"use server";

/**
 * Server action wrapper for the WordPress connection health check.
 *
 * Why the indirection over the helper:
 *   * The helper (`services/wordpress-connection-test-service.ts`)
 *     is a pure function that doesn't know about Supabase, RLS, or
 *     the blog row layout. This action is the single place where
 *     we read the stored credentials from the user-context client,
 *     fail closed if the row isn't visible (RLS), and hand the
 *     plain fields to the helper.
 *   * The returned object is intentionally a thin pass-through of
 *     the helper's `WordPressConnectionTestResult`. The application
 *     password NEVER appears on the wire back to the client — we
 *     only pull it server-side to build the Basic auth header.
 *
 * Auth posture mirrors `exportBlogSettingsTemplate`:
 *   * `createClient()` is the RLS-bound client; if the user can't
 *     see the row they get `"Blog not found."` (no enumeration).
 *   * No `assertCan(manage_blog)` here on purpose — RLS already
 *     gates `blogs` read access by project membership, and the
 *     Settings / Connections page is the only place that surfaces
 *     this action.
 */

import { createClient } from "@/lib/supabase/server";
import { testWordPressConnection } from "@/services/wordpress-connection-test-service";
import type { WordPressConnectionTestResult } from "@/lib/wordpress-connection-test-types";
import type { ActionResult } from "./workspace";

export interface TestBlogWordPressConnectionInput {
  teamId: string;
  projectId: string;
  blogId: string;
}

export async function testBlogWordPressConnection(
  input: TestBlogWordPressConnectionInput,
): Promise<ActionResult<WordPressConnectionTestResult>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  const { data: blog, error } = await supabase
    .from("blogs")
    .select("wp_url, wp_username, wp_app_password")
    .eq("id", input.blogId)
    .eq("project_id", input.projectId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }
  if (!blog) {
    return { data: null, error: "Blog not found." };
  }
  // `teamId` is on the action surface for symmetry with the URL
  // route + the other blog actions; RLS scopes by project so we
  // don't need to round-trip the team table here.
  void input.teamId;

  // Hand the plain fields to the helper. The helper returns
  // friendly error codes (missing_url / missing_username /
  // missing_password) if any are blank — so we deliberately don't
  // pre-validate here. That keeps a single source of truth for
  // error copy.
  const result = await testWordPressConnection({
    wpUrl: blog.wp_url ?? "",
    username: blog.wp_username ?? "",
    appPassword: blog.wp_app_password ?? "",
  });

  // Defense in depth: assert we're not echoing the password back.
  // The helper's return type doesn't include it, but a future
  // accidental property leak in a refactor would be caught here
  // before the value crosses the server/client boundary.
  /* v8 ignore next 3 -- defensive: helper return type has no password field today */
  if (
    typeof (result as { appPassword?: unknown }).appPassword !== "undefined"
  ) {
    return { data: null, error: "Internal error: credentials leaked." };
  }

  return { data: result, error: null };
}
