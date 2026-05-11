import { FatalError } from "workflow";
import {
  type GenerateArticleDraftFromIdeaResult,
  type TriggerSource,
  runGenerateArticleFromIdeaJob,
} from "@/services/article-generation-service";

/**
 * The first Vercel Workflow in the project.
 *
 * Generates a single article draft from a single approved idea, using
 * the existing two-phase orchestration:
 *
 *   * The server action (or future cron tick / autopilot scheduler)
 *     calls `queueGenerateArticleFromIdea`, which creates the durable
 *     `article_jobs` and `articles` rows and returns immediately.
 *   * That caller then invokes this workflow via `start(...)` from
 *     `workflow/api`, returning to the user without waiting on Claude.
 *   * The workflow's single step calls `runGenerateArticleFromIdeaJob`,
 *     which consumes tokens, talks to Claude, persists the article,
 *     converts the idea, and (on failure) refunds the user.
 *
 * Why "use workflow" + a single "use step" function instead of many
 * small steps:
 *
 *   * Step bodies retry up to 3 times by default. The article
 *     generation step is NOT safely retryable — credits are idempotent
 *     on the job id, but a successful Claude call followed by a
 *     transient DB write failure would, on retry, burn another Claude
 *     call without billing the user. We throw `FatalError` to disable
 *     retries; the existing refund-on-failure logic handles the user
 *     side, and the user can click Generate Article again to try once
 *     more (which creates a new job).
 *
 *   * Splitting the body into per-Claude-call steps makes sense once
 *     we add the outline + article + SEO + image steps. For the v1
 *     "one Claude call → one article" pipeline, the granularity isn't
 *     worth the extra complexity.
 *
 * Why workflows are not directly callable in tests:
 *   The Vercel Workflow SDK transforms `"use workflow"` / `"use step"`
 *   functions at build time. In Vitest the directives are inert
 *   strings and the function executes like any other async function —
 *   that's exactly what `generate-article.test.ts` exercises.
 *   Production behavior (durable state + step isolation) only kicks in
 *   when the function runs inside `next dev` or a Vercel deployment
 *   wrapped with `withWorkflow()` (see `next.config.ts`).
 */

export interface GenerateArticleWorkflowInput {
  /** Pre-existing job row from `queueGenerateArticleFromIdea`. */
  jobId: string;
  /** Pre-existing article placeholder. */
  articleId: string;
  blogId: string;
  teamId: string;
  ideaId: string;
  userId: string;
  triggerSource: TriggerSource;
  /** Set when the run was kicked by the (future) autopilot scheduler. */
  autopilotRunId?: string;
}

/**
 * Workflow entry point. Called via `start(generateArticleWorkflow, [...])`.
 * Returns the same `GenerateArticleDraftFromIdeaResult` shape as the
 * synchronous orchestration so future callers (a status poller, a
 * webhook handler) can reuse the type.
 */
export async function generateArticleWorkflow(
  input: GenerateArticleWorkflowInput,
): Promise<GenerateArticleDraftFromIdeaResult> {
  "use workflow";

  return await runGenerateArticleStep(input);
}

/**
 * The single step of the workflow. Runs in a full Node.js environment
 * (Supabase admin client, Anthropic SDK, env vars all available).
 *
 * Throws `FatalError` on any failure so the SDK doesn't retry — the
 * underlying `runGenerateArticleFromIdeaJob` already marks the job
 * failed AND refunds the user; a retry would Claude-call again on
 * Vercel's dime without consuming additional tokens.
 */
async function runGenerateArticleStep(
  input: GenerateArticleWorkflowInput,
): Promise<GenerateArticleDraftFromIdeaResult> {
  "use step";

  const workflowMetadata: Record<string, unknown> = {
    workflowName: "generateArticleWorkflow",
    workflowStartedAt: new Date().toISOString(),
  };
  if (input.autopilotRunId) {
    workflowMetadata.autopilotRunId = input.autopilotRunId;
  }

  try {
    return await runGenerateArticleFromIdeaJob({
      jobId: input.jobId,
      articleId: input.articleId,
      blogId: input.blogId,
      teamId: input.teamId,
      userId: input.userId,
      ideaId: input.ideaId,
      triggerSource: input.triggerSource,
      jobInputPatch: workflowMetadata,
    });
  } catch (err) {
    // The orchestration has already marked the job failed and (if
    // tokens were consumed) refunded the user. Wrap in FatalError so
    // the workflow SDK doesn't retry the step.
    const message = err instanceof Error ? err.message : String(err);
    throw new FatalError(message);
  }
}
