# MVP Autopilot QA — local end-to-end test plan

This doc is the **MVP testing playbook** for autopilot. Follow it in
order to verify every step of the loop:

```text
blog setup → idea backlog → article generation → image picker → WordPress draft → recent runs → run detail
```

The scenarios cover happy path, every failure mode the engine
distinguishes, multi-blog isolation, and the launch-style 10-posts/day
flow.

> **Scope.** Local dev, no live publishing, no scheduled publishing,
> no plan-tier logic. If you find behavior that should change, capture
> it with the [bug report template](#bug-report-template) and ship a
> small fix; do not bolt new product features onto this pass.

---

## 1. Environment setup

### 1.1 Required env vars

`apps/web/.env.local` must have:

| Var | What it powers | Where to get it |
|-----|---------------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | local Supabase URL | `supabase start` output |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client Supabase auth | `supabase start` output |
| `SUPABASE_SERVICE_ROLE_KEY` | admin/cron writes | `supabase start` output |
| `ANTHROPIC_API_KEY` | Claude (idea + article generation) | <https://console.anthropic.com/settings/keys> |
| `PEXELS_API_KEY` | featured + section images | <https://www.pexels.com/api/> |
| `CRON_SECRET` | gates `/api/cron/autopilot` | `openssl rand -hex 32` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | billing / token grants | `pnpm stripe:setup` |
| `NEXT_PUBLIC_APP_URL` | Stripe redirect URLs | `http://localhost:3000` |
| `UNSPLASH_ACCESS_KEY` | LEGACY — only needed for historical Unsplash rows | optional |

WordPress credentials are configured **per blog** in the
**Connections** tab — they are NOT env vars. You can use any
WordPress test site that supports application passwords (a local
LocalWP / Kinsta sandbox / wordpress.com Business plan works).

### 1.2 Run dev

```bash
# In repo root
supabase start
supabase db reset --local

# In apps/web (one terminal)
pnpm dev

# Optional — Stripe webhook listener for token grants
pnpm stripe:listen
```

### 1.3 Trigger autopilot manually

The committed `vercel.json` cron schedule is **daily at 08:00 UTC**
(autopilot) + **08:30 UTC** (reconciler). That's the only schedule
**Vercel Hobby** allows — Hobby caps cron jobs at once-per-day, and
pushing a `*/5` or `*/15` schedule fails the deploy with a link to
the Cron Jobs pricing docs.

For local QA + Vercel **Pro** production:

| Environment | How to trigger autopilot |
|-------------|-------------------------|
| **Local dev** | `curl` against the dev server (below) — fire as often as you want. |
| **Vercel Hobby** | Cron fires once daily at 08:00 UTC. For more frequent checks, manually `curl` the deployed URL with `Authorization: Bearer $CRON_SECRET`. |
| **Vercel Pro** | Edit `apps/web/vercel.json` to `*/15 * * * *` (or any sub-daily cadence) — Pro lifts the daily cap. The route handler + scheduler logic don't change. |

Local trigger:

```bash
# Dry run first — no workflows are actually started.
curl -i \
  -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/autopilot?dry_run=true"

# Real run.
curl -i \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/autopilot
```

Both routes accept `GET` (default Vercel cron) and `POST` (manual
scripts). The response is a JSON summary including `blogsChecked`,
`blogsEligibleTotal`, `blogsSkippedDueToLimit`, `runsCreated`,
`runsSkipped`, `runsFailed`, `articleJobsStarted`, plus a `perBlog`
array.

### 1.4 Inspect Vercel Workflows runs

```bash
npx workflow web      # browser UI
npx workflow inspect runs   # terminal inspector
```

Both attach to the dev server's runtime — useful for seeing
per-step failures inside `generateArticleWorkflow`.

---

## 2. Blog setup

Each scenario below assumes you've completed this section once.

1. **Sign up / sign in** at `http://localhost:3000`.
2. **Create a project**: dashboard → **New project** → name it
   `QA Project`.
3. **Create a blog**: project page → **New blog** → name it
   `QA Blog A`. Repeat for `QA Blog B` / `C` for the multi-blog
   scenario in §6.
4. **Open the blog → Settings** and configure each tab:

   | Tab | What to set |
   |-----|------------|
   | **Identity** | audience, language (en), tone, reading level (intermediate), point of view, default author persona. Keep these short — autopilot uses them as the AI system prompt. |
   | **Strategy** | goals (`educate`, `rank`), monetization, niche/competitors, content freshness, preferred article types, topics to cover/avoid. |
   | **AI** | positive/negative prompt, approved/banned terminology. Optional but useful for dialing tone. |
   | **SEO** | keyword usage (`balanced`), slug format (`lowercase-hyphenated`), default article length (1200), FAQ section + schema markup as desired. |
   | **Automation** | leave OFF for now (`mode=manual`, `enabled=false`). You'll arm it in §4. Configure `requireReview`, `generatePerWeek`, `maxPostsPerDay`, `backlogThreshold`, `dailyTokenBudget`, `timezone` here. |
   | **Publishing** | `defaultDestination=wordpress`, `defaultStatus=draft`, leave `autoSendToWordPressDraft` OFF for now. |
   | **Media** | `imageProvider=Pexels`, `autoPickImages=ON`. Image source field is "coming soon" — leave it as-is. |
   | **Advanced** | optional — custom system prompt, disclaimers, etc. |
5. **Connections → WordPress**: paste your test site URL, username,
   and an **application password** (NOT your account password).
   Click **Test connection** and confirm the green check appears.

> **Token balance.** Autopilot won't spawn anything without tokens.
> Run `pnpm stripe:setup` once to create test products/prices, then
> use the test card `4242 4242 4242 4242` to subscribe to **Starter**
> on `/billing`. The webhook grants 1 000 Synth tokens.

---

## 3. Manual flow

This walks the entire pipeline by hand so you can compare it against
the autopilot path in §4.

1. **Generate ideas** — open **Ideas** tab, click **Generate ideas**,
   pick a topic seed, submit. The button flips to "Generating…" then
   the new ideas appear with `status=generated` (yellow badge).
2. **Approve an idea** — click **Approve** on one card. Status flips
   to `approved` (green badge).
3. **Generate article** — click **Generate article** on the approved
   card. The card flips to `Generating` immediately (driven by
   `article_jobs.status='processing'`).
4. **Active-jobs tray** — bottom-right tray polls every 8 s and
   should show the in-flight job. When the workflow completes, the
   tray clears.
5. **Open the article** — `Posts` → click the new card. Verify:
   - Title + body markdown render correctly.
   - **Featured image** has `Photo by … on Pexels` credit.
   - At least one **section image** appears above an H2 with its own
     attribution.
   - Word count + generated-by-model badge visible.
6. **Send to WordPress draft** — on the article page click
   **Send to WordPress**. Verify:
   - WordPress publish card flips to "Synced — view draft".
   - Opening the draft on the WordPress side shows the article body
     with section image figures injected before each H2.
7. **Update WordPress draft** — edit the article body locally, click
   **Update draft**. Reload WordPress; the changes land.
8. **Publish live** — click **Publish to WordPress**. The article's
   local status flips to `published` and the WP post is `publish`.

---

## 4. Autopilot flow

> **Reset between scenarios.** Each subsection assumes a clean blog
> with no in-flight `article_jobs`. Either delete pending/processing
> jobs in Supabase Studio, or use a fresh blog (the multi-blog
> scenarios in §6 cover that pattern).

### 4.1 Arm autopilot

1. **Settings → Automation**: flip `Mode` to `Autopilot`, toggle
   `Enabled` ON. Configure:
   - `Generate per week`: 14 (= 2/day target)
   - `Max posts per day`: 3
   - `Require review`: ON (you'll flip it OFF in §4.3)
   - `Backlog threshold`: 5
   - `Daily token budget`: leave null
2. Click **Save changes**. The scheduler will see this blog on the
   next cron tick.

### 4.2 `requireReview = true` flow

1. Trigger cron: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/autopilot`
2. Open **Automation tab → Recent runs**. The newest row should:
   - Status: `completed` (or `skipped` if backlog already full).
   - Counter: "N ideas generated" (= the idea-batch size).
   - Reason: **No reason line** when the run did productive work,
     or one of the labels in [§4.7](#47-friendly-labels-cheat-sheet)
     when it skipped.
3. Open **Ideas** tab → newly-generated ideas land as `generated`
   (NOT `approved`). Approve a few by hand.
4. Trigger cron again. Article jobs should now spawn from the
   approved ideas. Confirm via the active-jobs tray + the recent-
   runs row counter ("N article jobs started").

### 4.3 `requireReview = false` flow

1. **Settings → Automation**: flip `Require review` OFF, save.
2. Trigger cron. The next run row should show:
   - Counter: "N ideas generated · N auto-approved".
3. Trigger cron a second time (give the workflow ~30 s to start).
   Article jobs should spawn for the auto-approved ideas without you
   touching the **Ideas** tab.

### 4.4 Auto-send WordPress draft ON / OFF

1. **Settings → Publishing**: toggle `Auto-send to WordPress draft`
   ON, save. Make sure the blog has a working WordPress connection
   (§2 step 5).
2. Trigger cron, wait for an article workflow to complete.
3. Open the **Run detail drawer** (click a recent-runs row). The
   spawned article job should show the **WordPress draft sent**
   badge + a `View WordPress draft →` link.
4. Toggle the setting OFF, trigger cron again. New runs' article
   jobs should NOT include the WP badge.

### 4.5 Run autopilot now

The blog settings page exposes a **Run autopilot now** button under
the Automation tab. It calls `runAutopilotForBlog` directly with
`triggerSource='manual'` — the recent-runs row's trigger column
shows `Manual` instead of `Scheduled`.

### 4.6 Recent runs panel + run detail drawer

For each run row, verify:

- **Status badge** matches the actual outcome (completed / skipped /
  failed).
- **Trigger** says `Scheduled` for cron and `Manual` for the
  in-app button.
- **Counters** make sense ("3 ideas generated · 2 auto-approved ·
  1 article jobs started · 1 completed").
- **Reason line**, when present, uses the friendly labels from
  [§4.7](#47-friendly-labels-cheat-sheet) — NOT the raw snake_case
  key.
- **Click the row** → drawer opens. Verify each section:
  - Header (status, trigger, timestamps, run id)
  - Summary counters
  - WordPress drafts (only when `wp_drafts_expected > 0`)
  - **Reason** card with friendly label + description
  - Budget & backlog (token balance, daily cap, approved-idea count)
  - Article jobs list with deep links
  - Ideas list
  - Raw run input / output JSON (expand to confirm raw
    `output.reason` key is preserved)

### 4.7 Friendly labels cheat sheet

When QA hits a skip path, the recent-runs row + run drawer should
render one of these labels (NEVER the raw snake_case key):

| Raw `output.reason` | Friendly label | When it fires |
|---------------------|----------------|---------------|
| `ok` | **Completed** | Run did productive work. |
| `partial_failure` | **Completed with issues** | Some workflows started; at least one queue/start threw. |
| `daily_article_cap_reached` | **Daily article target reached** | `articlesStartedToday >= maxPostsPerDay (or weekly/7)`. |
| `active_article_job_limit_reached` | **Autopilot is waiting for current article jobs to finish** | Per-blog operational throttle (3 in-flight). Backpressure — **not** a plan cap. |
| `active_team_article_job_limit_reached` | **Autopilot is waiting for team article jobs to finish** | Per-team operational throttle (20 in-flight). Backpressure — **not** a plan cap. |
| `no_approved_ideas_in_backlog` | **No approved ideas available** | Backlog ≥ threshold but nothing approved. |
| `backlog_empty_no_budget_for_ideas` | **No approved ideas and no idea budget** | Below threshold + can't afford an idea batch. |
| `idea_generation_failed` | **Idea generation failed** | Claude / network error during idea generation. |
| `insufficient_balance` | **Insufficient token balance** | Team can't afford a single idea batch. |
| `insufficient_token_budget` | **Daily token budget reached** | Per-blog `dailyTokenBudget` exhausted. |
| `no_work_needed` | **No work needed** | Healthy fallback. |
| `autopilot_disabled` | **Autopilot disabled** | Mode/enabled flip between cron load + tick. |
| `dry_run` | **Dry run completed** | `?dry_run=true` query param. |
| `team_billing_unavailable` | **Billing unavailable** | `getTeamPlan` returned null. |
| `blog_not_found` | **Blog not found** | Blog deleted between scan + tick. |

**Operational throttle copy MUST NOT contain** `plan` / `subscription` /
`tier` / `pricing` / `upgrade` / `paywall` — see
`apps/web/src/lib/autopilot-skip-reason-labels.test.ts` for the
regex guard.

---

## 5. Failure scenarios

Each section below walks one failure mode + the expected UI signal.
Capture anything off-pattern with the [bug template](#bug-report-template).

### 5.1 Missing `PEXELS_API_KEY`

1. Stop dev, comment out `PEXELS_API_KEY` in `.env.local`, restart.
2. Trigger an article generation (manual or autopilot).
3. The article workflow should still complete (image picker is
   best-effort), but `article_jobs.output.imageSummary.warnings`
   should contain `"missing_access_key"` strings.
4. Run drawer → article job row → expand **Image picker warnings**.
   The warning list should be visible.
5. The featured image / section images should be missing on the
   article detail page (expected — picker was skipped).
6. Restore the env var, restart dev.

### 5.2 Invalid `ANTHROPIC_API_KEY`

1. Set `ANTHROPIC_API_KEY=sk-ant-broken` in `.env.local`, restart.
2. Trigger autopilot. Observe:
   - Idea generation fails → run row stamped `failed` with reason
     `Idea generation failed`.
   - Tokens consumed for the failed call get refunded
     (`token_transactions` has both a `usage` row and a
     `refund::article_job::*` row).
3. After 3 failures inside the 30-min auto-pause window, autopilot
   auto-pauses the blog (`settings.automation.enabled=false`,
   `pausedReason='failure_rate'`). The Automation tab shows a
   warning banner.
4. Restore the key, re-enable autopilot.

### 5.3 WordPress disconnected

1. Make sure `auto-send to WordPress draft` is ON.
2. Connections tab → **Disconnect** WordPress.
3. Trigger autopilot. The article generation completes; the WP
   send step produces a `wpPublish.status='skipped_no_connection'`
   on the article job.
4. Run drawer → article job row should show
   **WordPress not connected** (not a failure — soft warning).
5. Recent-runs row's WordPress counters show
   `WordPress not connected` instead of "drafts created".

### 5.4 WordPress bad password

1. Connections tab → edit, replace the application password with
   junk. Save.
2. Trigger autopilot.
3. Article job should land with `wpPublish.status='failed'` and a
   401-flavored `wpPublish.warning`.
4. Run drawer → article job row → click **Retry WordPress draft**.
   The retry should fail again (bad password).
5. Restore a valid password, retry — the draft should send.

### 5.5 Insufficient tokens

1. Drain the team balance: open `token_balances` in Supabase Studio,
   set `balance = 0`.
2. Trigger autopilot. Run row should be `skipped` with reason
   **Insufficient token balance** when there's no approved backlog,
   OR run completes 0 articles when there is one.
3. Top up tokens via Stripe checkout; the next tick should resume
   normally.

### 5.6 No approved ideas

1. Reject every approved idea (or use a fresh blog).
2. Trigger autopilot with `requireReview=true`. The run row's reason
   should be **No approved ideas available**.

### 5.7 Daily article target reached

1. Set `maxPostsPerDay=3`, `generatePerWeek=21`.
2. Use the seed script to add 5 approved ideas:
   `pnpm autopilot:seed --blog-id <id> --count 5`.
3. Trigger cron three times (give workflows time between ticks). The
   cap should bind on the 4th tick — reason **Daily article target
   reached**, no new article jobs.

### 5.8 Operational backpressure (active job throttle)

1. With approved ideas in the backlog, trigger cron once. The first
   tick should spawn 3 article jobs (the per-blog operational
   throttle).
2. While those are still `pending`/`processing`, trigger cron again.
3. The second run row should be `skipped` with reason **Autopilot is
   waiting for current article jobs to finish**.
4. Wait for the workflows to finish, trigger cron a third time —
   the throttle releases and new jobs spawn.

### 5.9 Retry failed WordPress draft

1. Reproduce §5.4 (bad password) or §5.3 (disconnected).
2. Open the run drawer → click **Retry WordPress draft** on the
   failed job. Verify:
   - Spinner shows on that row.
   - Other rows' retry buttons are disabled while the retry is in
     flight.
   - On success: badge flips to "WordPress draft sent" + the
     `View WordPress draft →` link appears.
   - The autopilot run row's `wp_drafts_*` counters update.

---

## 6. Multi-blog scenario

Tests blog isolation: a problem on one blog must not block the
others.

1. **Setup** — three blogs in the same project:
   - `QA Blog A` — autopilot ON, healthy WordPress connection,
     `maxPostsPerDay=3`, `requireReview=false`.
   - `QA Blog B` — autopilot ON, **disconnected** WordPress (§5.3
     posture).
   - `QA Blog C` — autopilot ON, **bad WordPress password** (§5.4
     posture).
2. Seed ~5 approved ideas on each:
   ```bash
   pnpm autopilot:seed --blog-id <A-id>
   pnpm autopilot:seed --blog-id <B-id>
   pnpm autopilot:seed --blog-id <C-id>
   ```
3. Trigger cron once. Verify the response JSON has
   `blogsChecked: 3` and three `perBlog` entries.
4. **Blog A**: articles generate + WordPress drafts land.
5. **Blog B**: articles generate, WP step shows
   `skipped_no_connection`. Blog A is unaffected.
6. **Blog C**: articles generate, WP step shows `failed`. Blog A
   is still unaffected.
7. **Daily caps respected**: trigger cron repeatedly until Blog A
   hits `daily_article_cap_reached`. Confirm Blogs B + C still get
   processed (their daily counts are independent).

---

## 7. Launch-style scenario (10 posts/day)

End-to-end stress test of the daily cap.

1. **Configure a single blog** with:
   - `maxPostsPerDay=10`, `generatePerWeek=70`
   - `requireReview=false`
   - `autoSendToWordPressDraft=true`
   - WordPress connected
   - `dailyTokenBudget=null`
2. **Seed approved ideas** so the scheduler doesn't waste a tick on
   idea generation:
   ```bash
   pnpm autopilot:seed --blog-id <id> --count 20
   ```
3. **Trigger cron repeatedly** — wait for the workflows to drain
   between calls (or the operational throttle will skip the run):
   ```bash
   for i in 1 2 3 4 5; do
     curl -H "Authorization: Bearer $CRON_SECRET" \
       http://localhost:3000/api/cron/autopilot
     sleep 60
   done
   ```
4. **Verify daily cap holds**:
   ```sql
   SELECT count(*) FROM article_jobs
   WHERE blog_id = '<id>'
     AND type = 'generate_article'
     AND created_at::date = current_date;
   -- Expect: ≤ 10
   ```
5. **Verify WordPress drafts** were created (auto-send was ON):
   - Run detail drawer → **WordPress drafts** section shows
     `Expected = 10`, `Drafts created` near 10, `Failed = 0`.
   - Open the WordPress media library — section image figures are
     present in each draft.

---

## Bug report template

For each bug, capture **all** of the following so the fix PR has the
context it needs without a follow-up screen-share:

```text
## Summary
<one-sentence description>

## Identifiers
blog id:                <uuid>
project id:             <uuid>
team id:                <uuid>
article id:             <uuid or n/a>
article_job id:         <uuid or n/a>
blog_autopilot_run id:  <uuid or n/a>

## Settings snapshot
Paste the relevant subset of `blogs.settings`:
  - automation.{mode, enabled, requireReview, generatePerWeek, maxPostsPerDay,
    backlogThreshold, dailyTokenBudget, timezone, pausedReason}
  - publishing.{defaultDestination, defaultStatus, autoSendToWordPressDraft}
  - media.{imageProvider, autoPickImages}

## Expected behavior
<what should happen, plus the doc section that describes it>

## Actual behavior
<what actually happened, with the relevant friendly label / status badge>

## Output snapshots (from blog_autopilot_runs.output)
output.reason:        <raw key>
output.imageSummary:  <relevant subset, especially `warnings`>
output.wpPublish:     <{ status, warning, wpPostId, wpPostUrl }>
output.lastSpawnError: <if present>

## Logs
- Browser console:   <attach screenshot or trimmed text>
- Vercel Workflows:  `npx workflow inspect runs` output
- Server log lines:  trimmed `pnpm dev` output around the failure timestamp
- Supabase Studio:   relevant `article_jobs.error_message` /
                     `blog_autopilot_runs.error_message`

## Repro steps
1. ...
2. ...
3. ...
```

---

## Appendix — local dev helpers

### Seed approved ideas (skip Claude)

```bash
# Bulk-insert N approved ideas for a blog so autopilot has something
# to spawn articles from without burning tokens on idea generation.
pnpm autopilot:seed --blog-id <uuid>            # default 12
pnpm autopilot:seed --blog-id <uuid> --count 20
pnpm autopilot:seed --blog-id <uuid> --niche "fintech onboarding"
```

The script:

- Refuses to run when `NEXT_PUBLIC_SUPABASE_URL` isn't local.
- Stamps every row's `executive_summary` with the marker
  `autopilot-qa-seed` so cleanup is easy.
- Logs the cleanup SQL on completion.

Cleanup:

```sql
DELETE FROM article_ideas
WHERE blog_id = '<blog-id>'
  AND executive_summary = 'autopilot-qa-seed';
```

### Arm / disarm autopilot via SQL

```sql
-- Arm
UPDATE blogs
SET settings = jsonb_set(
  jsonb_set(settings, '{automation,mode}',    '"autopilot"'::jsonb),
  '{automation,enabled}', 'true'::jsonb
)
WHERE id = '<blog-id>';

-- Disarm + clear pause metadata
UPDATE blogs
SET settings = jsonb_set(
  jsonb_set(
    jsonb_set(settings, '{automation,enabled}', 'false'::jsonb),
    '{automation,pausedReason}', 'null'::jsonb
  ),
  '{automation,pausedAt}', 'null'::jsonb
)
WHERE id = '<blog-id>';
```

### Force a stuck-job for the reconciler

See [`apps/web/src/workflows/README.md`](../apps/web/src/workflows/README.md#local-testing) — the
workflow safety-net reconciler runs every 5 min and refunds tokens
on jobs older than 10 min in `pending`/`processing`.
