# Vercel Workflows

This folder contains the long-running Vercel Workflows that power
durable background work in the app. Today there's one:
`generate-article.ts` (manual article generation from an approved
idea). The autopilot scheduler will compose more here in later PRs.

## How a workflow run flows through the system

1. A user clicks **Generate article** on an approved idea card.
2. The `generateArticleFromIdea` server action
   (`apps/web/src/actions/article-generation.ts`):
   1. Verifies auth + the `consume_team_tokens` permission.
   2. Calls `queueGenerateArticleFromIdea(...)` which:
      - Validates the idea is `approved`.
      - Checks for an in-flight `generate_article` job for this idea
        (idempotency — second clicks short-circuit instead of
        double-billing).
      - Inserts an `article_jobs` row with `status='pending'` and a
        full input snapshot (settings, idea, triggerSource).
      - Inserts an `articles` row with `status='generating'` so the
        dashboard has something to show before generation finishes.
   3. Calls `start(generateArticleWorkflow, [{ jobId, articleId, ... }])`
      from `workflow/api`. This **returns immediately** with the
      run handle.
   4. Returns `{ jobId, articleId, status: "pending", workflowRunId }`
      to the UI.
3. The Vercel Workflows runner picks up the run and executes the
   single `runGenerateArticleStep` step:
   1. Stamps `article_jobs.input.workflowRunId` (best-effort).
   2. Calls `runGenerateArticleFromIdeaJob(...)` which:
      - Moves the job to `processing`.
      - Consumes Synth tokens (idempotent on `article_job::{jobId}`).
      - Calls Claude.
      - Writes the article + flips it to `ready_for_review`.
      - Logs a `usage_events` row.
      - Flips the idea to `converted_to_article`.
      - Marks the job `completed`.
   3. On any failure: marks the article + job `failed`, refunds the
      consumed credits (idempotent on `refund::article_job::{jobId}`),
      and re-throws as `FatalError` so the SDK does NOT retry the
      step (a retry would replay the Claude call without consuming
      additional tokens — Vercel pays, the user doesn't).

## Local testing

Vercel Workflows runs in `next dev` with no extra config beyond the
`withWorkflow()` wrapper in `next.config.ts` and the middleware
matcher exclusion for `/.well-known/workflow/*`. To exercise the
manual flow end-to-end on your machine:

```bash
pnpm dev
```

Then in the browser:

1. Sign in, open a blog with an approved idea.
2. Click **Generate article** on the idea card.
3. The card immediately renders a **Generating…** badge (driven by
   the active `article_jobs` row in Supabase). Refreshing the page
   keeps that state.
4. Once the workflow completes, refresh again — the idea flips to
   **Converted to article** with a **View article** link.

To inspect the workflow runs themselves, the SDK ships an
observability UI:

```bash
# Web UI (recommended)
npx workflow web

# or the terminal inspector
npx workflow inspect runs
```

Both attach to the local dev server's runtime. Use them to see step
inputs, step outputs, retries, and errors at a per-step level.

## Deployed testing

On Vercel, workflows just work — no extra deployment configuration
needed. Each push deploys the workflow alongside the app. The Vercel
dashboard surfaces the same runs/steps view via the Workflows tab on
the project.

## Environment variables

Workflows inherit the same env vars as the rest of the app
(`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ANTHROPIC_API_KEY`, etc.). No workflow-specific env vars are
required for v1.

## Why the workflow is one big step (not many small ones)

The article generation step is **not safely retryable** in the sense
the SDK assumes:

- `consume_team_tokens` is idempotent on the job id (good — replay
  is a no-op on the ledger).
- The Claude call is **not** idempotent at the API level. A
  successful Claude call followed by a transient DB write failure
  would, on a default 3x retry, burn 3 Claude calls while only
  consuming tokens once.

So the workflow throws `FatalError` to disable retries, and the
in-process orchestration's refund-on-failure is the recovery
mechanism. The user keeps their tokens and can click **Generate
article** again to create a fresh job.

If we ever split into multiple steps (outline / article / SEO / image),
each step gets its own job id and idempotency key, and the same
"throw FatalError" pattern keeps things billing-safe.

## What lives where

```text
apps/web/src/
 actions/article-generation.ts         # server actions (queue + start)
 services/article-generation-service.ts # queue + run helpers
 workflows/generate-article.ts          # "use workflow" + "use step"
 workflows/README.md                    # you are here
```

The service helpers (`queueGenerateArticleFromIdea` /
`runGenerateArticleFromIdeaJob`) intentionally know nothing about
the workflow runner. They can be invoked from:

- The server action (queue → start workflow), today.
- A future Vercel Cron route (loop blogs → queue → start workflow).
- The autopilot scheduler (composes this same workflow).
- A CLI / one-off script (`generateArticleDraftFromIdea` runs
  queue + run synchronously for tests + manual reprocessing).
