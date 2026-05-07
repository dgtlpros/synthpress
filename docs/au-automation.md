Yes, this all makes sense. The cleanest way to think about it is:

**Your SaaS is not “one AI prompt that writes a blog post.”**
It is a **content automation pipeline** where each blog has settings, strategy, memory, credits, jobs, review states, publishing destinations, and usage tracking.

## The simple version

A user creates a blog in your dashboard.

That blog has settings like:

```txt
Name: The Collector History
Niche: Ancient history, art, culture
Audience: curious readers, history fans
Tone: smart, easy to read, not academic
Positive prompt: explain clearly, use examples, include SEO headings
Negative prompt: avoid clickbait, avoid unsupported claims, avoid modern political commentary
Publishing mode: generate 10 posts/day, require review before publishing
CMS: WordPress
Image source: Unsplash
```

Then your system runs a scheduled job every day that says:

```txt
For this blog, create 10 new article ideas that fit the blog strategy, avoid duplicates, generate outlines, generate articles, find images, save drafts, and optionally schedule/publish them.
```

That is completely doable.

---

# The workflow I would build

## 1. Blog settings become the AI context

In Supabase, each blog should have a `blog_settings` or `blogs` record that stores the high-level fingerprint.

Example fields:

```ts
blog_name
blog_description
niche
target_audience
tone
reading_level
positive_prompt
negative_prompt
topics_to_include
topics_to_avoid
default_article_length
default_article_type
seo_style
internal_linking_enabled
image_style
automation_enabled
posts_per_day
requires_review
auto_publish_enabled
publishing_window_start
publishing_window_end
timezone
cms_connection_id
```

When you call Claude, you build a system prompt from those settings.

Something like:

```txt
You are writing for this blog:

Blog name: {{blog_name}}
Description: {{blog_description}}
Audience: {{target_audience}}
Tone: {{tone}}
Topics to focus on: {{topics_to_include}}
Topics to avoid: {{topics_to_avoid}}
Positive instructions: {{positive_prompt}}
Negative instructions: {{negative_prompt}}

Follow these SEO and quality rules:
...
```

So yes, the settings are enough to give the AI direction. But I would not rely on one giant prompt forever. I’d structure the workflow into stages.

---

# 2. Do not generate 10 full articles in one request

I would not ask Claude:

```txt
Generate 10 complete blog posts.
```

That will be harder to control, harder to retry, harder to track, and more expensive if something fails.

Instead, break it into a pipeline:

```txt
Step 1: Generate topic ideas
Step 2: Check for duplicates
Step 3: Generate title + summary
Step 4: Generate outline
Step 5: Generate full article
Step 6: Run quality/SEO check
Step 7: Find/select image
Step 8: Save draft
Step 9: Schedule or publish
```

This gives you way more control.

---

# 3. Recommended generation pipeline

## Stage 1: Generate topic ideas

Input:

```txt
Blog settings
Existing article titles
Existing article slugs
Recent topics
Topics to avoid
Target post count
```

Output:

```json
[
  {
    "title": "The Rise and Fall of the Roman Republic",
    "target_keyword": "fall of Roman Republic",
    "summary": "A clear explanation of how political corruption, military power, and social unrest contributed to the end of the Roman Republic.",
    "article_type": "educational",
    "priority": 1
  }
]
```

Save these as rows in a `post_ideas` or `articles` table with status:

```txt
idea_generated
```

---

## Stage 2: Duplicate check

Before writing the article, compare the idea against existing posts.

You can start with **Supabase only**:

```sql
articles
- id
- blog_id
- title
- slug
- summary
- target_keyword
- status
- published_at
```

For early MVP, this is enough. Pass the last 100 to 500 article titles/summaries into Claude and tell it to avoid duplicates.

Later, use embeddings/vector search.

That is where **Upstash Vector** or **Supabase Vector** becomes useful. You store embeddings for every article title, summary, and maybe outline. Then before generating a new post, you run a similarity search.

Example:

```txt
New idea: Best castles in medieval France

Vector search finds:
- 0.91 similarity: "10 Medieval French Castles You Should Know"
- 0.87 similarity: "How Castles Shaped Medieval France"

Decision:
Do not create this topic, or create a more specific angle.
```

My recommendation:

```txt
MVP: Supabase articles table + simple duplicate check
V2: Add vector search for semantic duplicate detection
```

You do not need Upstash on day one unless you already know you want it.

---

## Stage 3: Generate outline

Once the topic is approved, generate a structured outline.

Output:

```json
{
  "title": "...",
  "slug": "...",
  "meta_description": "...",
  "target_keyword": "...",
  "outline": [
    {
      "heading": "Introduction",
      "summary": "..."
    },
    {
      "heading": "Main Section",
      "summary": "..."
    }
  ],
  "image_search_query": "ancient roman senate architecture"
}
```

Save the outline. This lets the user review before generating the full article if they want.

---

## Stage 4: Generate article

Now call Claude again with:

```txt
Blog settings
Approved title
Summary
Outline
SEO requirements
Negative prompt
Internal link options
CMS formatting requirements
```

Output should be structured, not just raw text.

Example:

```json
{
  "title": "...",
  "slug": "...",
  "excerpt": "...",
  "meta_description": "...",
  "content_markdown": "...",
  "tags": ["Roman history", "Ancient Rome"],
  "categories": ["History"],
  "faq": [...],
  "image_search_query": "..."
}
```

Save the article as a draft.

---

## 5. Image workflow

Yes, you can use Unsplash or another image API.

Important: Unsplash requires attribution to the photographer and Unsplash, with links back when displaying photos from the API. ([Unsplash][1])

So your image table should store:

```ts
image_url
download_url
photographer_name
photographer_profile_url
unsplash_photo_url
attribution_html
source
alt_text
```

You should not just save the image URL and forget attribution.

A basic flow:

```txt
1. Claude generates image search query
2. Your backend searches Unsplash
3. Pick best result
4. Store image metadata + attribution
5. Generate alt text with AI
6. Attach image to article
7. If publishing to WordPress, upload or hotlink depending on your approach
```

For MVP, I’d let the user choose between:

```txt
No image
Unsplash image
AI-generated image later
Manual upload later
```

---

# 6. Autopilot architecture

I would build this around jobs.

You’ll want tables like:

```sql
blogs
blog_settings
articles
article_jobs
cms_connections
usage_events
credit_balances
```

Example `article_jobs`:

```sql
id
user_id
blog_id
article_id
type -- generate_idea, generate_outline, generate_article, publish_article
status -- pending, processing, completed, failed
attempts
error_message
scheduled_for
started_at
completed_at
created_at
```

The automation flow:

```txt
Cron runs every X minutes
↓
Find blogs where automation_enabled = true
↓
Check how many posts should be generated today
↓
Create article generation jobs
↓
Worker picks up jobs
↓
Calls Claude
↓
Saves results
↓
Runs image search
↓
Creates draft article
↓
If auto-publish is on, schedules/publishes to CMS
```

Supabase can handle a lot of this. Supabase has Cron for recurring jobs, and their docs describe background tasks for async operations in Edge Functions. ([Supabase][2])

That said, for a SaaS, I’d probably use one of these setups:

## Good MVP setup

```txt
Next.js app
Supabase database
Supabase Auth
Supabase Storage
Supabase Edge Functions
Supabase Cron
Stripe
Claude API
Unsplash API
```

## Better production setup

```txt
Next.js app
Supabase database/auth/storage
Trigger.dev, Inngest, or QStash for background jobs
Stripe
Claude API
Unsplash API
WordPress REST API
```

For 10 posts/day per user, you will eventually want a real background job system with retries, logs, concurrency limits, and failure handling.

---

# 7. How billing should work

Yes, you would usually use **your own Claude API key** behind the scenes.

The user should not bring their own Claude key unless you specifically want an advanced “bring your own key” feature.

The normal SaaS model is:

```txt
User pays you
You call Claude with your API key
You track usage internally
You deduct credits from the user
You keep margin between your AI cost and what you charge
```

Stripe supports usage-based billing and metered billing concepts, where you report usage and Stripe bills based on that usage. ([Stripe Docs][3])

Stripe also has billing credits for prepaid or promotional usage-based services, but their docs note those credits are for your own products/services and not stored value for third-party purchases. ([Stripe Docs][4])

So in your app, I’d frame it as:

```txt
AI credits
Article credits
Generation credits
```

Not as “Claude tokens.”

Because the user does not care about raw Claude tokens. They care about:

```txt
How many articles can I generate?
How many words can I generate?
How many images can I fetch?
How many blogs can I run?
```

---

# 8. Better pricing model

I would not expose raw token math to users at first.

Instead, sell plans like:

```txt
Starter
- 1 blog
- 30 articles/month
- Manual publishing
- Basic image search

Growth
- 5 blogs
- 300 articles/month
- Autopilot generation
- WordPress publishing
- Scheduling

Scale
- 20 blogs
- 2,000 articles/month
- Multi-CMS
- Advanced SEO
- Team seats
```

Behind the scenes, you track:

```txt
input_tokens
output_tokens
image_api_calls
article_count
publish_count
```

But the customer sees:

```txt
Articles used this month: 84 / 300
```

That is way simpler.

---

# 9. Credit deduction strategy

Do not deduct only after the final article is created. Deduct by job stage or reserve credits upfront.

Example:

```txt
Generate topic ideas: cheap
Generate outline: cheap-medium
Generate full article: expensive
Run quality check: cheap-medium
Generate/fetch image: cheap
Publish to CMS: free or cheap
```

For MVP, you can make it simpler:

```txt
1 article credit = 1 completed article draft
```

But internally, still log real AI usage:

```sql
usage_events
- user_id
- blog_id
- article_id
- provider
- model
- input_tokens
- output_tokens
- estimated_cost
- created_at
```

This protects your margins later.

---

# 10. Claude API usage

Claude is a good fit for this, especially because you can use structured outputs, long context, batch processing, and prompt caching.

Anthropic’s docs say the Message Batches API can process many independent requests and offers discounted batch pricing, while prompt caching is useful for repeated prompts with shared instructions and large consistent context. ([Claude API Docs][5])

That matters for your use case because every article for the same blog will reuse the same blog settings.

So your context could look like:

```txt
Cached blog context:
- Blog identity
- Tone
- Positive prompt
- Negative prompt
- SEO rules
- Content strategy
```

Then each generation call only adds:

```txt
- Specific title
- Specific outline
- Existing post references
```

This can reduce cost when generating multiple articles for the same blog.

---

# 11. The workflow in plain English

Here’s how the whole app works:

```txt
1. User creates a blog
2. User defines the blog fingerprint/settings
3. User chooses manual mode or autopilot mode
4. User buys a plan or credits through Stripe
5. Your cron/job system checks which blogs need content
6. Your backend creates generation jobs
7. Each job builds a prompt using blog settings
8. Claude generates ideas, outlines, and article drafts
9. Your app checks duplicates and quality
10. Your app fetches or suggests an image
11. The article is saved in Supabase
12. User reviews it or your system auto-schedules it
13. If connected, your app publishes to WordPress/CMS
14. You log usage and deduct credits
```

That’s the SaaS.

---

# 12. What I’d build first

Do not build the whole autopilot machine at once.

Build it in this order:

## Phase 1: Manual generation

User can:

```txt
Create blog
Add blog settings
Click Generate Post
Review/save article
Copy article manually
```

No autopilot yet.

## Phase 2: WordPress publishing

User can:

```txt
Connect WordPress
Send article as draft
Send article as published
```

## Phase 3: Batch generation

User can:

```txt
Generate 5 or 10 article ideas
Approve selected ideas
Generate drafts from those ideas
```

## Phase 4: Autopilot

User can:

```txt
Generate X posts/day automatically
Require review or auto-publish
Schedule posts
```

## Phase 5: Memory/vector search

Add:

```txt
Duplicate prevention
Internal linking suggestions
Content gap discovery
Topic clustering
```

---

# 13. Should you use Supabase or Upstash?

For your MVP:

```txt
Supabase is enough.
```

Use Supabase for:

```txt
blogs
settings
articles
jobs
usage
credits
cms connections
```

Add vector search later when you need semantic memory.

Use Upstash if you want:

```txt
Redis caching
QStash background jobs
Vector search outside Supabase
rate limiting
```

But don’t overcomplicate it at the beginning.

A good setup would be:

```txt
Supabase = source of truth
Upstash Redis = cache/rate limiting
Upstash Vector or Supabase Vector = article memory
QStash/Trigger/Inngest = job orchestration
```

---

# 14. The database shape I’d start with

```sql
blogs
- id
- user_id
- name
- description
- niche
- target_audience
- tone
- positive_prompt
- negative_prompt
- automation_enabled
- posts_per_day
- requires_review
- auto_publish_enabled
- created_at
- updated_at

articles
- id
- blog_id
- user_id
- title
- slug
- excerpt
- content_markdown
- meta_description
- target_keyword
- status
- word_count
- image_url
- image_attribution
- scheduled_for
- published_at
- created_at
- updated_at

article_jobs
- id
- user_id
- blog_id
- article_id
- job_type
- status
- attempts
- input
- output
- error_message
- scheduled_for
- started_at
- completed_at
- created_at

cms_connections
- id
- user_id
- blog_id
- provider
- site_url
- encrypted_credentials
- default_status
- default_category
- created_at

usage_events
- id
- user_id
- blog_id
- article_id
- provider
- model
- input_tokens
- output_tokens
- estimated_cost
- credits_used
- created_at

subscriptions
- id
- user_id
- stripe_customer_id
- stripe_subscription_id
- plan
- status
- article_limit
- articles_used
```

---

# 15. The main thing to avoid

Do **not** make your UI/API call Claude directly from the browser.

Bad:

```txt
Browser → Claude API
```

Good:

```txt
Browser → your Next.js API route/server action → check credits → create job → worker → Claude API → save result
```

Your API key should stay server-side.

Also, every generation should check:

```txt
Does this user have enough credits?
Is this blog active?
Is automation enabled?
Has this blog hit its daily limit?
Has this user hit their plan limit?
```

---

# 16. My recommended mental model

Think of each blog like a mini AI employee.

Each blog has:

```txt
Identity: what it is
Strategy: what it writes about
Rules: what it should and should not do
Memory: what it has already published
Schedule: when it works
Destination: where it publishes
Budget: how much it is allowed to spend
```

That is the product.

The MVP should be:

```txt
Create blog → configure fingerprint → generate article → save draft → publish/copy
```

Then autopilot becomes:

```txt
Do that automatically every day, within user limits.
```

So yes, this is absolutely possible. I’d start with Supabase as the source of truth, your own Claude API key on the backend, Stripe plans/credits for monetization, and a job pipeline that turns blog settings into article ideas, outlines, drafts, images, and scheduled posts.

[1]: https://unsplash.com/documentation?utm_source=chatgpt.com "Unsplash API Documentation | Free HD Photo API"
[2]: https://supabase.com/modules/cron?utm_source=chatgpt.com "Supabase Cron | Schedule Recurring Jobs in Postgres"
[3]: https://docs.stripe.com/api/billing/meter?utm_source=chatgpt.com "Meters | Stripe API Reference"
[4]: https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits?utm_source=chatgpt.com "Billing credits"
[5]: https://docs.anthropic.com/en/docs/build-with-claude/batch-processing?utm_source=chatgpt.com "Batch processing - Claude API Docs"
