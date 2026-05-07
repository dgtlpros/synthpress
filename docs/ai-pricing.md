Yes, you would typically use **your own Claude API key** server-side.

The user pays **you** through Stripe. Your app calls Claude in the background using **your API key**. Then you track usage inside your own database and enforce plan limits/credits. The user never sees your Claude key, and they usually do not need to bring their own.

## Could it be profitable?

Yes, it **can** be profitable, but only if you package it correctly.

The dangerous version is:

```txt
$19/month = unlimited AI articles
```

That can lose money fast.

The profitable version is:

```txt
$49/month = 50 articles
$99/month = 150 articles
$199/month = 500 articles
Extra article credits available
```

You want to sell **article credits**, not raw Claude tokens.

---

## Why it can work

Claude API pricing is token-based. Current Anthropic docs show Claude Sonnet 4.6 at **$3 per million input tokens** and **$15 per million output tokens**, while Claude Haiku 4.5 is **$1 per million input tokens** and **$5 per million output tokens**. Anthropic also supports prompt caching, where cache hits cost only **10% of the normal input price**, and Batch API jobs can reduce input/output token cost by **50%**. ([Claude][1])

That means your margins can be solid if you:

1. Use cheaper models for simple steps.
2. Use stronger models only for final article writing or quality checks.
3. Cache the blog settings/context.
4. Batch autopilot jobs when speed is not urgent.
5. Set clear monthly article limits.

---

## Rough cost example

Let’s say one article generation uses something like:

```txt
Input tokens: 8,000
Output tokens: 2,500
```

Using Claude Sonnet 4.6:

```txt
Input cost:
8,000 / 1,000,000 * $3 = $0.024

Output cost:
2,500 / 1,000,000 * $15 = $0.0375

Estimated Claude cost:
~$0.06 per article
```

That is just the core article generation. If you add idea generation, outline generation, SEO checks, retries, summaries, and image metadata, maybe your real cost becomes:

```txt
~$0.08 to $0.25 per article
```

If you sell 100 articles for $49/month, and your AI cost is around $10 to $25, you still have room for margin.

But if users generate huge 3,000-word articles with multiple retries and expensive models, your cost can climb.

---

## My honest take

Yes, I think this could make money.

But the value is **not** just “AI writes blog posts.” Anyone can ask ChatGPT or Claude to write an article.

The value is the system around it:

```txt
Create blog
Define blog fingerprint
Generate article ideas
Avoid duplicate topics
Generate outlines
Create full posts
Find images
Add SEO metadata
Schedule content
Publish to WordPress
Track usage
Run on autopilot
```

That is what people would pay for.

You are selling **automation and consistency**, not just AI text.

---

## How I would price it

I would start with simple SaaS plans:

```txt
Starter — $29/month
- 1 blog
- 25 articles/month
- Manual generation
- Copy/export only

Growth — $79/month
- 3 blogs
- 150 articles/month
- WordPress publishing
- Scheduling
- Basic autopilot

Scale — $199/month
- 10 blogs
- 500 articles/month
- Autopilot
- Batch generation
- Advanced SEO settings
- Multiple CMS connections later
```

Then add credit packs:

```txt
50 extra articles — $19
150 extra articles — $49
500 extra articles — $129
```

I’d avoid saying “tokens” to users. Say **articles**, **credits**, or **generations**.

---

## The Claude setup I’d use

Your backend would do this:

```txt
User clicks Generate
↓
Check subscription/credits in Supabase
↓
Create article job
↓
Worker builds prompt from blog settings
↓
Call Claude with your API key
↓
Save usage tokens from Claude response
↓
Deduct article credit
↓
Save article to Supabase
```

For autopilot:

```txt
Cron/job runs daily
↓
Find blogs with automation enabled
↓
Check how many articles they are allowed to generate
↓
Create jobs
↓
Generate articles in background
↓
Save drafts or schedule/publish
```

Your Claude API key lives only in your server environment:

```env
ANTHROPIC_API_KEY=...
```

Never expose it to the browser.

---

## Important: do not charge only after success

You need some protection against users burning compute through failed generations.

I’d do this:

```txt
Reserve 1 article credit when generation starts
If it succeeds, keep the charge
If it fails because of your system, refund the credit
If it fails because of user settings/content policy/bad CMS connection, maybe do not refund after retries
```

Also track actual Claude cost:

```txt
input_tokens
output_tokens
cache_read_tokens
cache_write_tokens
model
estimated_cost
```

That way, later you can see whether each plan is profitable.

---

## Where profit could get eaten up

The main risks are:

```txt
Users generating very long articles
Too many retries
Using expensive models for every tiny step
Unlimited plans
Auto-publishing errors causing repeated jobs
Image APIs with paid limits
WordPress publishing failures
Users creating hundreds of low-quality blogs on cheap plans
```

So you need limits:

```txt
Max article length by plan
Max posts per day
Max blogs per plan
Max retries per job
Monthly article cap
Rate limits
Daily autopilot cap
```

---

## Best model strategy

I would not use the same Claude model for everything.

Example:

```txt
Haiku:
- generate topic ideas
- classify article type
- create image search query
- quick SEO checks

Sonnet:
- generate outlines
- write full articles
- rewrite/improve drafts
- stronger quality checks

Opus:
- probably not needed for MVP
```

For autopilot content, Sonnet is probably the main workhorse. Haiku can handle cheaper supporting tasks.

---

## My recommendation

Build it like this:

```txt
MVP:
- User creates blog
- User fills blog settings
- User clicks Generate Article
- Your backend calls Claude
- Save draft in Supabase
- Track article usage
- Stripe plan limits

Then:
- Batch generate ideas
- Generate articles from approved ideas
- WordPress draft publishing
- Autopilot scheduling
- Duplicate detection/vector memory
```

So yes, I think this is a real SaaS idea. The key is to **not sell unlimited AI**, keep your Claude key server-side, price around **article volume**, and make the real value the autopilot workflow: strategy, generation, scheduling, image handling, CMS publishing, and content memory.

[1]: https://platform.claude.com/docs/en/build-with-claude/prompt-caching "Prompt caching - Claude API Docs"
