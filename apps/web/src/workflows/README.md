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
`ANTHROPIC_API_KEY`, etc.).

The **workflow safety-net reconciler** (see below) requires one
additional secret:

- `CRON_SECRET` — long random string. Vercel Cron sends this as
  `Authorization: Bearer ${CRON_SECRET}` against
  `/api/cron/reconcile-article-jobs`; the route rejects anything
  else with 401. Set it in `.env.local` for local testing and as a
  Vercel project env var for prod / preview.

## Workflow safety-net reconciler

The Vercel Workflow runner can die between steps for reasons we
don't control (deployment swap, runtime crash, infra incident).
When that happens, the `article_jobs` row stays in `pending` /
`processing` forever and the global tray spins on it indefinitely.

The reconciler at
`apps/web/src/app/api/cron/reconcile-article-jobs/route.ts` is the
safety net. Vercel Cron pings it every few minutes (configure in
`vercel.json` once we land that PR); it finds rows that haven't
moved in N minutes, marks them failed, marks the in-flight article
failed, and refunds any consumed-but-not-yet-refunded credits.

### Stale thresholds

Defaults live in
`DEFAULT_RECONCILE_THRESHOLDS_MINUTES` in
`services/article-generation-service.ts`:

| Job type           | Default stale threshold |
| ------------------ | ----------------------- |
| `generate_article` | 10 min                  |
| `generate_ideas`   | 5 min                   |

Override with `?older_than_minutes=` query param (TODO when needed)
or by calling `reconcileStuckArticleJobs({ olderThanMinutes })`
directly from a script.

### Refund detection

The reconciler trusts the **token ledger**, not the job's own
`output.refunded` flag. For each stuck job it queries
`token_transactions` for both:

- `idempotency_key = article_job::{jobId}` — the original consume
- `idempotency_key = refund::article_job::{jobId}` — any prior
  refund

It refunds only when the consume row exists AND the refund row
doesn't. Because `refundTeamTokens` is itself idempotent on the
refund key, even a slip in the detection wouldn't actually
double-credit — but skipping the call when we know we already paid
up keeps the audit log clean.

### Local testing

```bash
# .env.local
CRON_SECRET=dev-secret-not-for-prod

# In one terminal
pnpm dev

# In another terminal — fabricate a "stuck" job in Supabase Studio:
#   1. Find a recent article_jobs row.
#   2. UPDATE article_jobs SET created_at = now() - interval '20 minutes',
#      status = 'processing' WHERE id = '<id>';
#   3. Optionally fabricate a usage transaction so the refund path fires:
#      INSERT INTO token_transactions (user_id, amount, type, idempotency_key,
#      metadata) VALUES ('<owner-uuid>', -5, 'usage',
#      'article_job::<jobId>', '{}'::jsonb);

# Trigger the reconciler:
curl -i \
  -H "Authorization: Bearer dev-secret-not-for-prod" \
  http://localhost:3000/api/cron/reconcile-article-jobs

# Verify in Supabase Studio:
#   - article_jobs.status = 'failed', error_message contains "timed out"
#   - articles.status = 'failed' (when the job had a generating placeholder)
#   - token_transactions has a new row with idempotency_key
#     'refund::article_job::<jobId>' (when there was a usage row)
#   - Re-running the curl is a no-op: jobsChecked = 0 (the rows are
#     no longer in pending/processing) and tokensRefunded = 0.
```

To manually verify progress states in the global tray, edit
`article_jobs.current_step` in Supabase Studio while a job is in
`processing` — the next poll (every 8 s) will pick up the new step
and the bar will jump.

### Deployed cron

`vercel.json` at `apps/web/vercel.json` configures both cron routes:

```json
{
  "crons": [
    { "path": "/api/cron/reconcile-article-jobs", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/autopilot", "schedule": "*/15 * * * *" }
  ]
}
```

Vercel sends a `GET` to each route on the configured cadence with
`Authorization: Bearer ${CRON_SECRET}` set automatically.

## Autopilot scheduler

`/api/cron/autopilot` runs the per-blog autopilot scheduler.

Per cron tick:

1. Load up to 50 blogs whose owner has explicitly armed autopilot
   (`settings.automation.mode='autopilot' AND .enabled=true`).
2. For each blog, create a `blog_autopilot_runs` row in
   `processing`, then walk through:
   - `loading_settings` — re-confirm eligibility.
   - `checking_budget` — read team token balance, sum tokens already
     spent on this blog in the last 24h, derive a daily article cap
     from `maxPostsPerDay` + `ceil(generatePerWeek / 7)`.
   - `checking_backlog` — count approved ideas.
   - `generating_ideas` (only if `approvedIdeas < backlogThreshold`
     AND budget allows) — call the same `generateArticleIdeas`
     helper the manual flow uses, with `triggerSource='autopilot'`
     and `jobMetadata={ autopilotRunId }`.
   - `generating_articles` — for up to
     `min(approvedIdeas.length, articleSlotsRemainingToday,
articlesAllowedByTokens, PER_RUN_ARTICLE_CAP=5)` ideas, queue
     a job + start a workflow with `autopilotRunId` in the input.
   - `completed` — close the run with `status='completed'`,
     `status='skipped'` (no work was needed), or `status='failed'`
     (an unexpected exception escaped). Counters and a budget /
     backlog snapshot land on `output`.

### What autopilot does NOT do

- Auto-approve ideas. New ideas land as `status='generated'` and
  wait for human review.
- Auto-publish articles. Drafts land as `ready_for_review`
  regardless of `requireReview` (publishing ships in a later PR).
- Re-spawn workflows for jobs already pending/processing on the
  same idea. `queueGenerateArticleFromIdea` short-circuits with
  `alreadyQueued=true`.

### Per-run + global safety caps

| Cap                    | Source                                | Behavior                                                          |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Per-blog daily article | `min(maxPostsPerDay, ceil(weekly/7))` | Subtracts today's already-started count.                          |
| Per-blog daily tokens  | `dailyTokenBudget` (jsonb), nullable  | Subtracts today's `usage_events.credits_used` for this blog.      |
| Team-wide tokens       | `team owner balance`                  | `floor(balance / cost_per_article)` articles allowed.             |
| Per-run hard cap       | `PER_RUN_ARTICLE_CAP = 5`             | Always wins. Keeps a single tick from going wild on cold start.   |
| Approved-idea backlog  | `backlogThreshold` (jsonb)            | Below threshold → top up via idea generation; above → skip ideas. |

### Local testing

```bash
# .env.local
CRON_SECRET=dev-secret-not-for-prod

# Arm autopilot on a blog (Supabase Studio):
UPDATE blogs
SET settings = jsonb_set(
  jsonb_set(settings, '{automation,mode}',    '"autopilot"'::jsonb),
  '{automation,enabled}', 'true'::jsonb
)
WHERE id = '<your-blog-id>';

# Optional: approve an idea so the article-spawning path runs
UPDATE article_ideas SET status = 'approved'
WHERE id = '<some-generated-idea-id>';

pnpm dev

# Dry run first — see what the scheduler WOULD do without actually
# spawning workflows or generating ideas:
curl -i \
  -H "Authorization: Bearer dev-secret-not-for-prod" \
  "http://localhost:3000/api/cron/autopilot?dry_run=true"

# Real run:
curl -i \
  -H "Authorization: Bearer dev-secret-not-for-prod" \
  http://localhost:3000/api/cron/autopilot

# Verify in Supabase Studio:
#   - blog_autopilot_runs has a new row with status completed/skipped/failed
#   - blog_autopilot_runs.current_step landed at 'completed'
#   - blog_autopilot_runs.output has the budget + backlog snapshot
#   - blog_autopilot_runs.ideas_generated / .articles_started counters
#     reflect what happened
#   - article_jobs spawned by the scheduler have:
#       input.triggerSource = 'autopilot'
#       input.autopilotRunId = the blog_autopilot_runs.id
#   - The global active-jobs tray shows the new "Generating…" rows
#     within ~8s of the curl returning.
```

### "Run autopilot now" for a single blog

For one-off testing without waiting for the cron tick (or to
confirm a freshly-armed blog), call the per-blog helper directly
from a script / `next dev` REPL:

```ts
import { runAutopilotForBlog } from "@/services/autopilot-scheduler-service";

await runAutopilotForBlog({
  teamId: "<team-id>",
  projectId: "<project-id>",
  blogId: "<blog-id>",
  triggerSource: "manual",
  triggeredByUserId: "<your-uuid>", // for the audit log
});
```

A future PR can wrap this in a server action + a "Run autopilot
now" button on the blog settings page; deferred so this PR stays
focused on the scheduler.

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
