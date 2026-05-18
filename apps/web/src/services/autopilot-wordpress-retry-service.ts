import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  Json,
  Tables,
  TablesUpdate,
} from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  hasBlogWordPressConnection,
  PublishArticleError,
  publishArticleToWordPressDraft,
} from "./wordpress-publish-service";
import { PUBLISH_ARTICLE_ERROR_COPY } from "@/lib/wordpress-publish-error-copy";
import { syncAutopilotRunWordPressDraftCounters } from "./blog-autopilot-run-service";
import type { AutopilotWordPressPublishResult } from "./article-generation-service";

/**
 * Retry surface for autopilot WordPress draft sends.
 *
 * Why this lives in its own service (rather than inside the
 * generation service): the retry path is callable from a user
 * action *after* the article workflow has already completed +
 * settled `article_jobs.output.wpPublish`. It must NEVER touch
 * tokens, NEVER regenerate content, and MUST merge the new
 * `wpPublish` into the existing `output` without clobbering
 * sibling keys (`imageSummary`, `creditsUsed`, etc.). That is a
 * read-merge-write pattern — same as `markJobRefunded` — and is
 * isolated here so the WP retry logic stays auditable in one
 * file.
 */

type Client = SupabaseClient<Database>;

// ============================================================================
// Errors
// ============================================================================

/**
 * Validation / pre-flight errors raised by the retry service.
 *
 * Distinct from {@link PublishArticleError} because these surface
 * *before* the publish helper runs — they describe the retry
 * *target* being invalid (job doesn't exist, doesn't belong to
 * this run, isn't in a retryable state, etc.). The action layer
 * maps each code to UI copy via {@link RETRY_ERROR_COPY}.
 */
export type RetryAutopilotWpDraftErrorCode =
  | "job_not_found"
  | "job_blog_mismatch"
  | "job_run_mismatch"
  | "job_missing_article_id"
  | "job_not_retryable"
  | "article_not_found"
  | "article_missing_content"
  | "no_wp_connection";

export class RetryAutopilotWpDraftError extends Error {
  readonly code: RetryAutopilotWpDraftErrorCode;
  constructor(code: RetryAutopilotWpDraftErrorCode) {
    super(`retry_autopilot_wp_draft_error:${code}`);
    this.name = "RetryAutopilotWpDraftError";
    this.code = code;
  }
}

/** UI-ready copy for each retry-side error code. */
export const RETRY_ERROR_COPY: Record<
  RetryAutopilotWpDraftErrorCode,
  string
> = {
  job_not_found: "We couldn't find the article job to retry.",
  job_blog_mismatch:
    "That job belongs to a different blog. Reload and try again.",
  job_run_mismatch:
    "That job belongs to a different autopilot run. Reload and try again.",
  job_missing_article_id:
    "That job never produced an article, so there's nothing to send to WordPress.",
  job_not_retryable:
    "That job's WordPress send is not in a retryable state.",
  article_not_found: "The article for that job no longer exists.",
  article_missing_content:
    "The article has no content to send to WordPress yet.",
  no_wp_connection: "Connect WordPress before retrying the draft send.",
};

// ============================================================================
// Public surface
// ============================================================================

export interface RetryAutopilotWordPressDraftInput {
  /** The autopilot run that owns the article job. */
  runId: string;
  /** The blog that owns both the run and the article job. */
  blogId: string;
  /** The `article_jobs.id` whose `wpPublish` is being retried. */
  jobId: string;
  /** Optional admin client; defaults to a fresh service-role client. */
  client?: Client;
  /** Optional fetch impl, forwarded to the WordPress helper. Tests use this. */
  fetchImpl?: typeof fetch;
}

export interface RetryAutopilotWordPressDraftResult {
  /**
   * The new `wpPublish` payload that was merged into
   * `article_jobs.output`. Callers can echo this back to the UI
   * without having to re-fetch the job row.
   */
  wpPublish: AutopilotWordPressPublishResult;
}

/**
 * Retries the WordPress draft send for a single autopilot article
 * job. Validates all the pre-conditions the spec calls out (job
 * exists + belongs to the right blog/run, article exists + has
 * content, WP is connected, the prior outcome is `failed` or
 * `skipped_no_connection`), then either:
 *
 *   1. Returns an `already_sent` result if `articles.wp_post_id`
 *      is already populated — idempotency guard so a race-y
 *      double-click doesn't create a duplicate draft.
 *   2. Calls {@link publishArticleToWordPressDraft} and persists
 *      the outcome (`draft_created` on success, `failed` with
 *      friendly copy on failure).
 *
 * Always re-syncs `blog_autopilot_runs.wp_drafts_*` counters via
 * {@link syncAutopilotRunWordPressDraftCounters} at the end.
 *
 * Throws {@link RetryAutopilotWpDraftError} on validation
 * failures. Never throws on a downstream WP publish failure —
 * that's recorded as a `failed` outcome on the job and returned
 * to the caller for surfacing.
 */
export async function retryAutopilotJobWordPressDraft(
  input: RetryAutopilotWordPressDraftInput,
): Promise<RetryAutopilotWordPressDraftResult> {
  const supabase = input.client ?? createAdminClient();

  // 1. Load + validate the job row. We re-read in this service
  //    (rather than trust the caller's argument) so the auth
  //    boundary in the action and the data boundary here stay
  //    independent — a stale UI can't sneak through.
  const job = await loadArticleJob(supabase, input.jobId);
  if (!job) throw new RetryAutopilotWpDraftError("job_not_found");
  if (job.blog_id !== input.blogId) {
    throw new RetryAutopilotWpDraftError("job_blog_mismatch");
  }
  const jobRunId = readJobInputRunId(job.input);
  if (jobRunId !== input.runId) {
    throw new RetryAutopilotWpDraftError("job_run_mismatch");
  }
  if (!job.article_id) {
    throw new RetryAutopilotWpDraftError("job_missing_article_id");
  }
  if (!isRetryableWpPublishStatus(job.output)) {
    throw new RetryAutopilotWpDraftError("job_not_retryable");
  }

  // 2. Load the article — confirm content exists before we make
  //    an outbound WP request. Also reads `wp_post_id` for the
  //    idempotency guard below.
  const article = await loadArticle(supabase, job.article_id, input.blogId);
  if (!article) throw new RetryAutopilotWpDraftError("article_not_found");
  if (!article.content_markdown || article.content_markdown.trim() === "") {
    throw new RetryAutopilotWpDraftError("article_missing_content");
  }

  // 3. WordPress connection gate. Skips before any POST.
  const hasConnection = await hasBlogWordPressConnection(input.blogId, supabase);
  if (!hasConnection) {
    throw new RetryAutopilotWpDraftError("no_wp_connection");
  }

  // 4. Idempotency: if the article was already pushed to WP (by
  //    a prior retry that succeeded but couldn't write back, or
  //    by manual Send), short-circuit to `already_sent` and
  //    re-sync counters. This is the same guard
  //    `maybeSendAutopilotWordPressDraft` uses on the workflow
  //    path — keeps the two entry points in sync.
  let wpPublish: AutopilotWordPressPublishResult;
  if (article.wp_post_id !== null) {
    wpPublish = {
      attempted: false,
      status: "already_sent",
      wpPostId: article.wp_post_id,
      wpPostUrl: article.wp_post_url ?? null,
    };
  } else {
    // 5. Actual publish. Captures failure as the typed
    //    `wpPublish.failed` outcome — never propagates as a
    //    thrown error, mirroring the autopilot-side helper.
    try {
      const result = await publishArticleToWordPressDraft({
        articleId: job.article_id,
        blogId: input.blogId,
        client: supabase,
        fetchImpl: input.fetchImpl,
      });
      wpPublish = {
        attempted: true,
        status: "draft_created",
        wpPostId: result.wpPostId,
        wpPostUrl: result.wpPostUrl,
      };
    } catch (err) {
      // Two failure flavors:
      //   * `PublishArticleError` — known code with friendly UI
      //     copy already curated in `PUBLISH_ARTICLE_ERROR_COPY`.
      //   * Anything else (network blip surfacing before the
      //     publish helper wrapped it, etc.) — fall back to the
      //     underlying message via `String(err)`. For `Error`
      //     instances that yields `"Error: <message>"`, which
      //     is fine to surface in the UI here since this branch
      //     is itself a defensive fallback (the publish helper
      //     normally wraps everything as PublishArticleError).
      wpPublish = {
        attempted: true,
        status: "failed",
        warning:
          err instanceof PublishArticleError
            ? PUBLISH_ARTICLE_ERROR_COPY[err.code]
            : String(err),
      };
    }
  }

  // 6. Merge the new wpPublish into the existing job output
  //    without dropping sibling keys (imageSummary, creditsUsed,
  //    refunded, etc.). Same read-merge-write pattern as
  //    `markJobRefunded`.
  await mergeWpPublishIntoJobOutput(supabase, input.jobId, wpPublish);

  // 7. Roll up the new outcome into the run-level counters. The
  //    sync helper is idempotent + absolute, so even if the
  //    retry races a still-completing sibling job they converge.
  await syncAutopilotRunWordPressDraftCounters({
    runId: input.runId,
    blogId: input.blogId,
    client: supabase,
  });

  return { wpPublish };
}

// ============================================================================
// Internal helpers
// ============================================================================

type ArticleJobRow = Pick<
  Tables<"article_jobs">,
  "id" | "blog_id" | "article_id" | "input" | "output"
>;

async function loadArticleJob(
  client: Client,
  jobId: string,
): Promise<ArticleJobRow | null> {
  const { data, error } = await client
    .from("article_jobs")
    .select("id, blog_id, article_id, input, output")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

type ArticleRow = Pick<
  Tables<"articles">,
  "id" | "content_markdown" | "wp_post_id" | "wp_post_url"
>;

async function loadArticle(
  client: Client,
  articleId: string,
  blogId: string,
): Promise<ArticleRow | null> {
  const { data, error } = await client
    .from("articles")
    .select("id, content_markdown, wp_post_id, wp_post_url")
    .eq("id", articleId)
    .eq("blog_id", blogId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Reads `output.wpPublish.status` defensively and tells the caller
 * whether it's one of the two retryable values. Returns `false`
 * for any malformed shape so a corrupted output can't be mistaken
 * for "already done" (which would block legitimate retries).
 *
 * Retryable: `failed`, `skipped_no_connection`.
 * Not retryable: `draft_created`, `already_sent`, or
 *                no `wpPublish` key at all.
 */
function isRetryableWpPublishStatus(output: Json | null): boolean {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return false;
  }
  const wp = (output as Record<string, Json>).wpPublish;
  if (wp === null || typeof wp !== "object" || Array.isArray(wp)) return false;
  const status = (wp as Record<string, Json>).status;
  return status === "failed" || status === "skipped_no_connection";
}

/**
 * Extracts `input.autopilotRunId` defensively. Same shape the
 * workflow stamps via `jobInputPatch` and the same key
 * `getBlogAutopilotRunDetail` filters on. Returns `null` for
 * anything that isn't a non-empty string.
 */
function readJobInputRunId(input: Json | null): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const v = (input as Record<string, Json>).autopilotRunId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Read-merge-write of `article_jobs.output` so the new `wpPublish`
 * coexists with sibling keys (`imageSummary`, `creditsUsed`, etc.).
 *
 * Concurrency note: writes between completion of the original job
 * and the retry are rare in practice (the autopilot workflow is
 * the only other writer to `output`, and it's already done by the
 * time the retry button appears). A small race window exists if
 * the user clicks Retry twice quickly — the UI gates that, and
 * the worst case is a clobber of one read-modify-write by the
 * other, which is acceptable here (the wpPublish payload is
 * idempotent per status).
 */
async function mergeWpPublishIntoJobOutput(
  client: Client,
  jobId: string,
  wpPublish: AutopilotWordPressPublishResult,
): Promise<void> {
  const { data, error: readErr } = await client
    .from("article_jobs")
    .select("output")
    .eq("id", jobId)
    .maybeSingle();
  if (readErr) throw readErr;
  /* v8 ignore next 4 -- defensive: we just validated existence in loadArticleJob; covers an extreme race where the job is deleted between load + merge */
  if (!data) {
    throw new RetryAutopilotWpDraftError("job_not_found");
  }
  const currentOutput =
    data.output && typeof data.output === "object" && !Array.isArray(data.output)
      ? (data.output as Record<string, unknown>)
      : {};

  const update: TablesUpdate<"article_jobs"> = {
    output: {
      ...currentOutput,
      wpPublish: wpPublish as unknown as Json,
    } as Json,
  };

  const { error: updateErr } = await client
    .from("article_jobs")
    .update(update)
    .eq("id", jobId);
  if (updateErr) throw updateErr;
}
