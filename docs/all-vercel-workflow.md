Yes — you were right to question that. **Vercel/Next has moved a lot here.** The thing you’re thinking of is likely **Vercel Workflows** plus the **Vercel AI SDK**.

My updated recommendation:

```txt
Use Vercel AI SDK for calling Claude.
Use Vercel Workflows for the long-running article generation pipeline.
Use Vercel Cron to start scheduled/autopilot runs.
Use Supabase as the database/source of truth.
Use Next.js for the dashboard and user-triggered actions.
```

That is probably the cleanest path since you already use Next.js and Vercel.

## What each piece does

### 1. Next.js

Next.js should handle the dashboard and normal user actions:

```txt
Create blog
Update blog settings
Click “Generate Ideas”
Click “Generate Article”
Approve/reject articles
View article status
```

The dashboard should **not** sit there waiting for a full article to finish.

### 2. Supabase

Supabase should be your source of truth:

```txt
users
blogs
blog_settings
article_ideas
articles
article_jobs
usage_events
cms_connections
subscriptions
```

Everything important gets saved here.

### 3. Vercel AI SDK

This is probably what you should use to call Claude instead of directly using only the Anthropic SDK. The AI SDK is Vercel’s TypeScript toolkit for building AI-powered apps across Next.js, Node, Vue, Svelte, and more, and it supports provider abstraction. Vercel’s docs show Anthropic/Claude support through the AI SDK, including `generateText` with Anthropic models. ([Vercel][1])

That means your app can start with Claude, but later switch or fallback to another model more easily.

Example mental model:

```txt
generateObject()
→ Claude returns structured JSON
→ validate with Zod
→ save to Supabase
```

For your article pipeline, structured output matters a lot.

### 4. Vercel Workflows

This is the important new piece. Vercel Workflows went generally available in April 2026 and is built for long-running, durable, reliable, observable agents and backend workflows. Vercel describes it as a way to write long-running functions in TypeScript or Python, with steps isolated using `"use step"` and the workflow wrapped with `"use workflow"`. It handles queues, retries, step isolation, observability, durable state, and streaming under the hood. ([Vercel][2])

That maps really well to your app.

Your article pipeline is exactly this kind of workflow:

```txt
Generate idea
Check duplicates
Generate outline
Generate article
Run SEO check
Find image
Save draft
Publish to CMS
```

Vercel’s workflow product page also says it supports long-running workflows without timeout limits, which is the exact reason it is better suited than a regular route handler for this. ([Vercel][3])

### 5. Vercel Cron

Vercel Cron should only be the trigger, not the whole worker. Vercel Cron jobs are available on all plans and can run Vercel Functions on a schedule. ([Vercel][4])

So cron’s job is basically:

```txt
Every 15 minutes:
Find blogs with autopilot enabled
Create/schedule workflow runs
```

Cron should not generate 100 articles itself.

---

# The approach I would use

## Manual generation flow

```txt
User clicks “Generate Article”
↓
Next.js route/server action checks auth + credits
↓
Create article_jobs row in Supabase
↓
Start Vercel Workflow
↓
Workflow builds article step-by-step
↓
Each step saves progress to Supabase
↓
Dashboard polls/subscribes to job status
↓
Article becomes ready_for_review
```

## Autopilot flow

```txt
Vercel Cron runs every 15 minutes
↓
Cron calls protected route
↓
Route finds blogs where automation_enabled = true
↓
Checks plan limits, credits, daily post limits
↓
Creates article_jobs rows
↓
Starts Vercel Workflow for each job
↓
Workflow generates/saves/schedules/publishes articles
```

This is the “right way” from the beginning.

---

# Why I would not rely only on normal Next.js routes

Regular Vercel Functions can work for shorter AI calls, but they still have duration limits. AI SDK troubleshooting docs say Fluid Compute defaults to 5 minutes, with max duration depending on plan: Hobby up to 300 seconds, Pro/Enterprise up to about 800 seconds. ([AI SDK][5])

That is fine for:

```txt
Generate 10 ideas
Generate one quick outline
Run a short AI call
```

But it is not ideal for:

```txt
Generate 10 full posts
Retry failed calls
Wait on API rate limits
Fetch images
Publish to WordPress
Run quality checks
```

Vercel Workflows is better because every step can be durable and retryable instead of one giant fragile function.

---

# Why I would not make Supabase Edge Functions the main worker

Supabase Edge Functions are useful, but their wall-clock duration is limited. Supabase lists Edge Function maximum duration as 150 seconds on Free and 400 seconds on paid plans. ([Supabase][6])

That is fine for webhooks or small tasks, but your article pipeline will eventually need durability, retries, observability, and step-by-step progress.

So I would use Supabase for data, not as the core AI workflow engine.

---

# Best architecture for your app

```txt
Next.js / Vercel
├── Dashboard UI
├── API routes / server actions
├── Vercel Cron trigger
├── Vercel Workflows for article generation
└── Vercel AI SDK for Claude calls

Supabase
├── Auth
├── Database
├── Storage
├── RLS
└── Realtime status updates later

Stripe
├── Subscriptions
├── Credits
└── Usage tracking

External APIs
├── Claude through Vercel AI SDK
├── Unsplash/Pexels images
└── WordPress REST API
```

I would not introduce Trigger.dev/Inngest yet if you are already committed to Vercel and want the simplest Vercel-native path. Trigger.dev and Inngest are still good options, but Vercel Workflows now makes the “keep it all in Next/Vercel” approach much more realistic.

---

# The flow I would build first

Start with **one complete workflow**, but keep it simple.

```txt
Generate one article draft from one blog
```

Not 10 articles yet.

The first real pipeline should be:

```txt
1. User clicks Generate Article
2. Create article_jobs row with status pending
3. Start Vercel Workflow
4. Workflow loads blog settings
5. Workflow generates one article idea
6. Workflow generates outline
7. Workflow generates full markdown article
8. Workflow saves article to Supabase
9. Workflow updates article_jobs status to completed
10. UI shows article as ready_for_review
```

Then expand it to:

```txt
Generate 10 ideas
Approve idea
Generate article from idea
Batch generate
Autopilot
Image search
WordPress publishing
```

---

# The actual sequence of events I’d design

## First version: manual article workflow

```txt
Dashboard
User clicks “Generate Article”
```

```txt
Next.js server action/API route
- Verify user session
- Verify blog belongs to user
- Check subscription/credits
- Insert article_jobs row
- Trigger Vercel Workflow with jobId
- Return jobId to UI
```

```txt
Vercel Workflow
- Step 1: Load job/blog/user settings
- Step 2: Load existing posts/ideas
- Step 3: Generate article idea with Claude
- Step 4: Generate outline with Claude
- Step 5: Generate full article with Claude
- Step 6: Generate SEO metadata
- Step 7: Save article draft
- Step 8: Deduct credit/log usage
- Step 9: Mark job completed
```

```txt
Dashboard
- Shows job status
- Shows current step
- Opens article when complete
```

---

# Tables I would create now

```sql
article_jobs
- id
- user_id
- blog_id
- article_id
- type
- status
- current_step
- error_message
- input jsonb
- output jsonb
- attempts
- started_at
- completed_at
- created_at
- updated_at
```

```sql
articles
- id
- user_id
- blog_id
- title
- slug
- excerpt
- content_markdown
- meta_description
- target_keyword
- status
- word_count
- generated_by_model
- created_at
- updated_at
```

```sql
usage_events
- id
- user_id
- blog_id
- article_id
- job_id
- provider
- model
- input_tokens
- output_tokens
- estimated_cost
- credits_used
- created_at
```

---

# What I’d tell Cursor after this research

I would not tell Cursor “integrate Claude” only.

I would tell Cursor:

```txt
Build the foundation for AI article generation using Vercel AI SDK + Vercel Workflows + Supabase job tracking.
```

Because if you only add a Claude route now, you may have to refactor it soon.

The next Cursor prompt should ask it to:

```txt
1. Add Vercel AI SDK with Anthropic provider.
2. Add article_jobs and articles schema if missing.
3. Add a Vercel Workflow for generating one article draft.
4. Add a server action/API route to start that workflow.
5. Add dashboard UI to trigger the job and display job status.
6. Save every important result to Supabase.
```

## My final recommendation

Yes, use the Vercel-native approach:

```txt
Vercel AI SDK + Vercel Workflows + Vercel Cron + Supabase
```

That is the cleanest architecture for where you are right now.

Use normal Next.js routes only to **start jobs** and handle quick actions. Use **Vercel Workflows** for the actual article-building process. Use **Vercel Cron** later for autopilot scheduling. Use **Supabase** to store the state of everything.

[1]: https://vercel.com/docs/ai-sdk?utm_source=chatgpt.com "AI SDK"
[2]: https://vercel.com/blog/a-new-programming-model-for-durable-execution?utm_source=chatgpt.com "A new programming model for durable execution"
[3]: https://vercel.com/workflow?utm_source=chatgpt.com "Vercel Workflows"
[4]: https://vercel.com/docs/cron-jobs "Cron Jobs"
[5]: https://ai-sdk.dev/docs/troubleshooting/timeout-on-vercel?utm_source=chatgpt.com "Getting Timeouts When Deploying on Vercel"
[6]: https://supabase.com/docs/guides/functions/limits?utm_source=chatgpt.com "Limits | Supabase Docs"
