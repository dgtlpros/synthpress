import { FatalError } from "workflow";
import {
  type GenerateArticleIdeasResult,
  type TriggerSource,
  runGenerateArticleIdeasJob,
} from "@/services/article-generation-service";

/**
 * Vercel Workflow for the manual "Generate ideas" UI flow.
 *
 * Mirrors {@link generateArticleWorkflow} so the article-job tray UX
 * (immediate close, polling spinner, completion notification) is
 * identical for both Generate Article and Generate Ideas. The shape:
 *
 *   * The server action calls `queueGenerateArticleIdeas`, which
 *     creates the durable `article_jobs` row and returns immediately.
 *   * That action then invokes this workflow via `start(...)` from
 *     `workflow/api`, returning to the UI without waiting on Claude.
 *   * The workflow's single step calls `runGenerateArticleIdeasJob`,
 *     which consumes tokens, talks to Claude, inserts ideas, logs
 *     usage, completes the job, and (on failure) refunds the user.
 *
 * Why "use workflow" + a single "use step" function:
 *   Same reasoning as `generate-article.ts` — the unit of work is one
 *   Claude call. Splitting it into more granular steps would let the
 *   SDK retry sub-pieces, but a successful Claude call followed by a
 *   transient DB failure should NOT trigger a retry that issues a
 *   second Claude call. We throw `FatalError` to disable retries; the
 *   underlying runner already refunded the user, and the user can
 *   click Generate Ideas again to try once more.
 *
 * Autopilot path note: the autopilot scheduler still calls
 * `generateArticleIdeas` directly (synchronous in-cron-tick) because
 * the scheduler is itself a background job — adding a second workflow
 * hop would be redundant. Both paths funnel into the same shared
 * executor in `article-generation-service.ts`, so refund/retry
 * semantics are identical.
 *
 * Why workflows are not directly callable in tests:
 *   The Vercel Workflow SDK transforms `"use workflow"` / `"use step"`
 *   functions at build time. In Vitest the directives are inert
 *   strings and the function executes like any other async function —
 *   that's exactly what `generate-ideas.test.ts` exercises.
 *   Production behavior (durable state + step isolation) only kicks in
 *   when the function runs inside `next dev` or a Vercel deployment
 *   wrapped with `withWorkflow()` (see `next.config.ts`).
 */

export interface GenerateIdeasWorkflowInput {
  /** Pre-existing job row from `queueGenerateArticleIdeas`. */
  jobId: string;
  blogId: string;
  teamId: string;
  /** Captured for symmetry with the article workflow; not used by the runner. */
  projectId: string;
  userId: string;
  triggerSource: TriggerSource;
  brief?: string | null;
  count: number;
  /** Set when the run was kicked by the autopilot scheduler. */
  autopilotRunId?: string;
}

/**
 * Workflow entry point. Called via `start(generateIdeasWorkflow, [...])`.
 * Returns the same {@link GenerateArticleIdeasResult} shape as the
 * synchronous orchestration so future callers (a status poller, a
 * webhook handler) can reuse the type.
 */
export async function generateIdeasWorkflow(
  input: GenerateIdeasWorkflowInput,
): Promise<GenerateArticleIdeasResult> {
  "use workflow";

  return await runGenerateIdeasStep(input);
}

/**
 * The single step of the workflow. Runs in a full Node.js environment
 * (Supabase admin client, Anthropic SDK, env vars all available).
 *
 * Throws `FatalError` on any failure so the SDK doesn't retry — the
 * underlying `runGenerateArticleIdeasJob` already marks the job
 * failed AND refunds the user; a retry would Claude-call again on
 * Vercel's dime without consuming additional tokens (the consume is
 * idempotent on the job id).
 */
async function runGenerateIdeasStep(
  input: GenerateIdeasWorkflowInput,
): Promise<GenerateArticleIdeasResult> {
  "use step";

  const workflowMetadata: Record<string, unknown> = {
    workflowName: "generateIdeasWorkflow",
    workflowStartedAt: new Date().toISOString(),
  };
  if (input.autopilotRunId) {
    workflowMetadata.autopilotRunId = input.autopilotRunId;
  }

  try {
    return await runGenerateArticleIdeasJob({
      jobId: input.jobId,
      blogId: input.blogId,
      teamId: input.teamId,
      userId: input.userId,
      brief: input.brief,
      count: input.count,
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
