# SynthPress Dashboard — Build Spec

> **Purpose**: This document describes the SynthPress Dashboard — a Next.js application that serves as the AI content generation and publishing platform for a network of 20 WordPress sites syndicated to MSN. Give this file to an AI assistant so it knows exactly what to build.

---

## Background

We have a network of WordPress sites hosted on Kinsta. Each site:
- Runs a standard WordPress install with REST API enabled
- Has an MSN-compliant RSS feed at `/feed/msn:article`
- Auto-syndicates published posts to MSN Partner Hub
- Has mu-plugins that auto-enable MSN syndication meta on every new publish
- Has a safety net that blocks publishing without a featured image

The sites are fully configured and working. What we need is **the content engine** — a dashboard that generates AI articles and publishes them to any of our WordPress sites automatically, all managed from one place.

---

## What This App Does

```
SynthPress Dashboard (Next.js)
  │
  ├── Projects (1 per WordPress site / niche)
  │   ├── synthpress01 → fitness niche, 1 article/day
  │   ├── tech-insider → tech niche, 2 articles/day
  │   └── ... up to 20 projects
  │
  ├── AI Content Pipeline
  │   ├── Generate article (title, body, SEO meta)
  │   ├── Generate or source featured image
  │   └── Format as WordPress-ready HTML
  │
  ├── WordPress Publisher
  │   ├── Upload featured image → /wp-json/wp/v2/media
  │   ├── Create post → /wp-json/wp/v2/posts
  │   └── Verify publish succeeded
  │
  ├── Scheduler / Cron
  │   └── Per project: run N times/day, generate + publish articles
  │
  └── Dashboard UI
      ├── Login / auth
      ├── Project list with status
      ├── Per-project settings page
      ├── Publish history / logs
      └── Manual publish trigger
```

---

## The WordPress REST API (how publishing works)

Each WordPress site has a bot user (`synthpress-bot`, role: Editor) with an Application Password. Publishing is 2 HTTP calls:

### Step 1: Upload featured image

```
POST https://{site-url}/wp-json/wp/v2/media
Headers:
  Authorization: Basic {base64(username:app-password)}
  Content-Disposition: attachment; filename="image.jpg"
  Content-Type: image/jpeg
Body: binary image data

Response: { "id": 42, "source_url": "https://..." }
```

### Step 2: Create the post

```
POST https://{site-url}/wp-json/wp/v2/posts
Headers:
  Authorization: Basic {base64(username:app-password)}
  Content-Type: application/json
Body: {
  "title": "Article Title",
  "content": "<p>Article body in HTML...</p>",
  "status": "publish",
  "featured_media": 42,
  "categories": [1]
}

Response: { "id": 123, "status": "publish", "link": "https://..." }
```

### What happens automatically after publishing

You don't need to do anything else. The WordPress site handles the rest:

- **`auto-enable-msn-syndication.php` (mu-plugin)** — auto-sets `syndication_tool_enabled`, schema types, AI disclosure, and backlink meta on every new publish
- **`featured-image-requirement.php` (mu-plugin)** — if no featured image, reverts to draft (safety net)
- **msn-syndication-2 plugin** — includes the post in the MSN RSS feed at `/feed/msn:article`
- **Kinsta cache** — auto-purges so the post is live immediately
- **MSN crawler** — picks up the post from the feed every few minutes

---

## Data Model

### Projects table

| Field | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| name | string | Display name (e.g. "SynthPress Fitness") |
| slug | string | URL-safe identifier |
| niche | string | Topic/niche (e.g. "fitness", "tech", "pets") |
| wp_url | string | WordPress site URL (e.g. "https://synthpress01.kinsta.cloud") |
| wp_username | string | Bot username (e.g. "synthpress-bot") |
| wp_app_password | string (plaintext today; encryption-at-rest planned — see Security Notes) | WordPress Application Password |
| ai_prompt_template | text | System prompt for AI article generation |
| keywords | string[] | Target keywords/topics for this niche |
| articles_per_day | int | How many articles to auto-generate per day (default: 1) |
| schedule_cron | string | Cron expression for when to publish (e.g. "0 9 * * *") |
| is_active | boolean | Enable/disable auto-publishing |
| created_at | timestamp | |
| updated_at | timestamp | |

### Articles table

| Field | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| project_id | UUID | FK to projects |
| title | string | Article title |
| content | text | HTML content |
| featured_image_url | string | URL of generated/sourced image |
| wp_post_id | int | WordPress post ID after publishing |
| wp_post_url | string | Published URL |
| status | enum | `draft`, `generating`, `ready`, `publishing`, `published`, `failed` |
| ai_model | string | Which model generated it |
| ai_prompt | text | The actual prompt used |
| error_message | text | If status = failed, why |
| published_at | timestamp | |
| created_at | timestamp | |

### Users table

Standard auth table (id, email, password hash, role). Start with single-user, can add team support later.

---

## Pages / Routes

| Route | Description |
|---|---|
| `/login` | Auth page |
| `/dashboard` | Overview: all projects, recent publishes, status cards |
| `/projects` | List of all projects |
| `/projects/new` | Create a new project |
| `/projects/[id]` | Project detail: settings, publish history, manual trigger |
| `/projects/[id]/settings` | Edit WP credentials, niche, schedule, AI prompt |
| `/projects/[id]/articles` | List of all articles for this project |
| `/projects/[id]/articles/[id]` | Article detail: content preview, publish status |
| `/articles/generate` | Manual: pick a project, generate an article, preview, publish |

---

## AI Content Generation

Each project has an `ai_prompt_template` that defines the niche voice. The generation flow:

1. Pick a topic (from keywords list, trending topics, or AI-suggested)
2. Generate article (title + 800-1500 word body in HTML with proper heading hierarchy)
3. Generate or source a featured image (DALL-E, stock API, or AI image service)
4. Store as draft in the Articles table
5. Publish to WordPress via REST API
6. Update article record with wp_post_id and status

### Content requirements for MSN compatibility

- Clean HTML with proper `<h2>`, `<h3>`, `<p>` structure
- No inline styles or JavaScript
- Featured image is mandatory (WordPress mu-plugin enforces this)
- Alt text on all images
- 800-1500 words minimum
- AI disclosure is injected automatically by the WordPress plugin

---

## Scheduler

Each active project runs on its own schedule:

```
For each active project:
  1. Check: articles_published_today < articles_per_day?
  2. If yes: generate article → publish to WordPress
  3. Log result (success/failure) to articles table
  4. Wait for next scheduled run
```

Options for implementation:
- **Vercel Cron** (if hosted on Vercel) — simple, serverless, free tier available
- **Node-cron** (if self-hosted) — in-process scheduler
- **BullMQ + Redis** — if you need robust job queuing with retries
- **External**: Trigger.dev, Inngest, or similar

---

## Recommended Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router)** | Full-stack, server components, API routes |
| Database | **PostgreSQL** (via Supabase or Neon) | Relational, good for structured project/article data |
| ORM | **Prisma** or **Drizzle** | Type-safe queries |
| Auth | **NextAuth.js** or **Clerk** | Simple, supports email + password |
| AI | **OpenAI GPT-4** or **Anthropic Claude** | Article generation |
| Image | **OpenAI DALL-E** or **Unsplash API** | Featured image generation/sourcing |
| Scheduling | **Vercel Cron** or **Trigger.dev** | Reliable, serverless-friendly |
| Hosting | **Vercel** | Zero-config Next.js deployment |
| Styling | **Tailwind CSS + shadcn/ui** | Fast, beautiful, consistent |

---

## Security Notes

- **Application Password storage — current vs. planned.** `blogs.wp_app_password` is a plaintext `text` column today (see `supabase/migrations/00001_initial_schema.sql` / `00014_blogs_optional_wp.sql`). The `pgcrypto` extension is already enabled in the database, so adding column-level encryption-at-rest is a follow-up PR — track it before claiming "credentials are encrypted at rest" anywhere in product copy. Until then, the credential row is protected by RLS + the service-role boundary: only server actions (and the autopilot scheduler) read it; the column is never selected into responses sent to the browser.
- **No app password ever crosses to the client.** The connection-test action (`testBlogWordPressConnection`) loads the credentials server-side, builds the Basic auth header for the test fetch, and only forwards a sanitized `WordPressConnectionTestResult` — a defensive assertion in the action fails closed if a future refactor accidentally adds the password to the result shape.
- All WordPress API calls use HTTPS (Kinsta forces this)
- The bot user on each WordPress site is an Editor (limited capabilities, no admin access)
- The `restrict-author-login.php` mu-plugin blocks the bot from wp-admin login (REST API only)
- Dashboard auth uses Supabase Auth + RLS — `blogs` is row-scoped by project membership, so an unauthorized user requesting the connection test gets `"Blog not found."` (no enumeration).

---

## What Already Exists (don't rebuild)

The WordPress sites are fully configured. The Next.js app does NOT need to handle:

- MSN syndication (the WordPress plugin handles this automatically)
- SEO/schema (Rank Math handles this automatically)
- Alt text (Auto Image Attributes plugin handles this automatically)
- AI disclosure for MSN (mu-plugin handles this automatically)
- Cache purging (Kinsta handles this automatically)

The app only needs to: **generate content, upload image (locally via REST API), create post, track status**.

---

## MVP Scope (build this first)

1. Auth (single user login)
2. Projects CRUD (create, edit, list projects with WP credentials)
3. Manual article generation (pick project → generate with AI → preview → publish)
4. Publish history (list of all published articles per project)
5. Connection test — **shipped.** Connections tab → **Test connection** button hits `GET /wp-json/wp/v2/users/me?context=edit` against the saved credentials and renders healthy / warnings / error panels. Stock WordPress REST API + Application Passwords only; no SynthPress companion plugin required. Tests **saved** values — save first, then test.
6. Connection package import — **shipped.** Connections tab → **Paste connection package** lets users paste the JSON exported by the SynthPress WordPress plugin (Settings → SynthPress). Pre-fills site URL and (when the plugin reports the bot user exists) suggests a username. The Application Password is **always** pasted separately by the user; package parsing strips any credential-shaped fields with an explicit warning. Parser + types live in `apps/web/src/lib/wordpress-connection-package.ts`; UI in `apps/web/src/components/molecules/WordPressConnectionPackageImporter/`.

### After MVP

6. Automated scheduler (cron-based auto-publishing per project)
7. Bulk generation (generate N articles at once, queue for publishing)
8. Analytics (pull basic stats from WordPress REST API)
9. MSN Analytics integration
10. Multi-user / team support

---

## WordPress Sites Info

| Field | Value |
|---|---|
| Hosting | Kinsta |
| PHP | 8.2+ |
| Theme | Twenty Twenty-Five (stock, no child theme) |
| Auth method | HTTP Basic + Application Passwords |
| REST API base | `/wp-json/wp/v2/` |
| MSN feed | `/feed/msn:article` |
| Bot user role | Editor |
| Plugins | msn-syndication-2, Rank Math, Auto Image Attributes, Disable Comments, User Role Editor |
| MU-Plugins | auto-enable-msn-syndication.php, featured-image-requirement.php, restrict-author-login.php |

---

## Quick Reference: WordPress REST API Endpoints

| Action | Method | Endpoint |
|---|---|---|
| List posts | GET | `/wp-json/wp/v2/posts` |
| Create post | POST | `/wp-json/wp/v2/posts` |
| Update post | PUT | `/wp-json/wp/v2/posts/{id}` |
| Delete post | DELETE | `/wp-json/wp/v2/posts/{id}` |
| Upload media | POST | `/wp-json/wp/v2/media` |
| List media | GET | `/wp-json/wp/v2/media` |
| List categories | GET | `/wp-json/wp/v2/categories` |
| Create category | POST | `/wp-json/wp/v2/categories` |
| List users | GET | `/wp-json/wp/v2/users` |
| Site info | GET | `/wp-json/` |
