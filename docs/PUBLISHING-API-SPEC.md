# SynthPress Publishing API — Integration Spec

> **Purpose**: Reference for how the SynthPress Dashboard publishes to WordPress via REST. For boilerplate deploy and new-site setup, see **[`wordpress/README.md`](../wordpress/README.md)** (canonical `wordpress/` folder; `wordpress-devkinsta/` is local/dev only).

---

## Overview

SynthPress publishes using **only the built-in REST API** and **Application Passwords**. **No custom SynthPress WordPress plugin is required** for MVP.

Sites deployed with the [`wordpress/`](../wordpress/) boilerplate add mu-plugins and plugins for MSN syndication, SEO, and publish guardrails. Those run **on WordPress after** SynthPress writes the post — SynthPress does not send MSN or Rank Math meta today.

```
SynthPress Dashboard (wordpress-publish-service.ts)
  │
  │  1. Upload featured image (if configured) ──► POST /wp-json/wp/v2/media
  │  2. Upload section images (per H2, if any) ───► POST /wp-json/wp/v2/media
  │  3. Build HTML (markdown → sanitized HTML + section <figure>s)
  │  4. Resolve category / tags / author (optional) ──► GET/POST categories, tags, users
  │  5. Create or update post ─────────────────────► POST or PUT /wp-json/wp/v2/posts
  │
  ▼
WordPress (when using the boilerplate kit, on live publish)
  ├── auto-enable-msn-syndication.php sets syndication meta (status → publish only)
  ├── featured-image-requirement.php blocks publish without featured image
  ├── msn-syndication-2 serves /feed/msn:article
  ├── Rank Math, Auto Image Attributes, etc.
  └── Kinsta cache purge (Kinsta hosts)
```

**Dashboard behavior today:** create/update **drafts**, manual **publish live** from the article page, autopilot **draft-only** auto-send (`autoSendToWordPressDraft`). Autopilot does **not** auto live-publish.

---

## Authentication

Every API call uses HTTP Basic auth with a WordPress Application Password.

```
Authorization: Basic {base64(username:app-password)}
```

| Field | Example |
|---|---|
| Username | `synthpress-bot` |
| App Password | `XXXX XXXX XXXX XXXX XXXX XXXX` (generated in WP Admin → Users → Application Passwords) |
| Role | Editor (needs `edit_posts`, `publish_posts`, `upload_files`, `edit_others_posts`) |

The SynthPress Dashboard stores these per-project (one WordPress site = one project).

### Optional: importing a connection package

The SynthPress WordPress companion plugin (`wordpress/wp-content/plugins/synthpress/`) renders a JSON **connection package** containing the site URL, REST URL, recommended bot username, and readiness checks. The dashboard's Connections tab can import that package via **Paste connection package** → **Review package** → **Use this connection** to pre-fill the WordPress URL and a username hint in one click.

Security invariants of the import flow:

- The package never contains an Application Password, API key, or any other secret — the WordPress plugin refuses to emit one, and the dashboard parser (`apps/web/src/lib/wordpress-connection-package.ts`) additionally strips any credential-shaped field (`password`, `applicationPassword`, `wp_app_password`, `token`, `apiKey`, etc.) and emits a single warning when one is found.
- The importer **only** writes `wpUrl` and (optionally) `wpUsername`. It never touches the Application Password field.
- Importing does not save or test the connection — the user must still paste the Application Password, click **Save changes**, and then **Test connection**.

### Testing the connection

The dashboard ships a built-in health check on the **Connections** tab of every blog. Clicking **Test connection** runs:

```
GET https://{site-url}/wp-json/wp/v2/users/me?context=edit
Authorization: Basic {credentials}
```

against the **saved** credentials (the action reads `wp_url`, `wp_username`, `wp_app_password` from `public.blogs` — unsaved form values are not tested; save first, then test). The implementation lives in:

- `apps/web/src/services/wordpress-connection-test-service.ts` — pure helper, accepts an injected `fetch` so it's unit-testable.
- `apps/web/src/actions/wordpress-connection-test.ts` — `testBlogWordPressConnection` server action; loads credentials via RLS and hands plain fields to the helper.
- `apps/web/src/hooks/useWordPressConnectionTest.ts` + `apps/web/src/connectors/BlogConnectionsConnector.tsx` — wire the button into the Connections page.

The response shape (`WordPressConnectionTestResult` in `apps/web/src/lib/wordpress-connection-test-types.ts`) carries:

- `ok: boolean`
- `siteUrl: string` (normalized — trailing slashes stripped)
- `user?: { id, name?, slug?, roles? }`
- `capabilities?: { canCreatePosts?, canPublishPosts?, canUploadMedia?, canCreateTerms? }` — built best-effort from WP's `capabilities` block when present, or from a conservative role-name heuristic (administrator / editor / author / contributor / subscriber) as a fallback.
- `warnings: string[]` — surfaced when capabilities suggest the user can't publish, can't upload media, or can't create terms.
- `error?: { code, message }` for failures — `missing_url`, `missing_username`, `missing_password`, `invalid_url`, `unauthorized` (401), `forbidden` (403), `rest_not_found` (404 — wrong site URL or REST disabled), `not_wordpress` (response wasn't a WP user payload), `invalid_json`, `network_error`, `unexpected`.

The application password is **never** returned to the client — the server action defensively asserts the helper's result has no `appPassword` field before forwarding it.

Out-of-band, you can hit the same endpoint with `curl` — useful for triaging a 401 outside the dashboard:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -u 'synthpress-bot:YOUR_APP_PASSWORD' \
  'https://your-site.example/wp-json/wp/v2/users/me'
```

---

## Publishing Flow (step by step)

### Step 1: Upload the featured image

The featured image **must** be uploaded first. WordPress will reject the publish (revert to draft) if there's no featured image — the `featured-image-requirement.php` mu-plugin enforces this.

```http
POST https://{site-url}/wp-json/wp/v2/media
Authorization: Basic {credentials}
Content-Type: image/jpeg
Content-Disposition: attachment; filename="golden-retriever-puppy-playing-fetch.jpg"

{binary image data}
```

**Response:**
```json
{
  "id": 42,
  "source_url": "https://site.kinsta.cloud/wp-content/uploads/2026/05/golden-retriever-puppy-playing-fetch.jpg",
  "media_details": {
    "width": 1200,
    "height": 800,
    "sizes": { ... }
  }
}
```

Save `id` (you'll need it for `featured_media`) and `source_url` (if you want to use it in the article body).

**Filename matters:** The Auto Image Attributes plugin generates alt text from the filename. Use descriptive, hyphenated filenames like `golden-retriever-puppy-playing-fetch.jpg` — not `img_001.jpg` or `DALL-E-output.png`.

### Step 2: Upload section images (if any)

The dashboard uploads **section images** tied to article H2s (`article_image_uploads` with `role = 'section'`). Each is uploaded via the same media endpoint, then injected into HTML as:

```html
<figure class="synthpress-section-image">
  <img class="wp-image-{id}" src="..." alt="...">
</figure>
```

**Generic inline markdown images** (`![alt](url)`) are **not** uploaded to WordPress media today — they remain external `https://` URLs in the post body (sanitizer allows http/https only).

If you need every body image in the Media Library, use section images or a future inline-upload feature — do not assume Step 2 covers arbitrary markdown images.

### Step 3: Build the article HTML

For **featured and section images**, use WordPress media URLs from Steps 1–2. MSN-oriented sites should avoid relying on long-lived external image URLs in published content.

**Required HTML structure:**

```html
<p>Opening paragraph that hooks the reader...</p>

<h2>First Major Section</h2>
<p>Section content with substantive paragraphs...</p>

<img src="https://site.kinsta.cloud/wp-content/uploads/2026/05/inline-image.jpg"
     alt="Descriptive alt text for this image"
     title="Image title">

<h2>Second Major Section</h2>
<p>More content...</p>

<h3>Subsection If Needed</h3>
<p>Subsection content...</p>

<h2>Conclusion</h2>
<p>Wrapping up the article...</p>
```

**Content rules:**

| Rule | Why |
|---|---|
| Use `<h2>` and `<h3>` for headings (never `<h1>`) | `<h1>` is the post title; Rank Math expects this hierarchy |
| Use `<p>` tags for paragraphs | Clean structure for MSN feed parsing |
| No inline styles | MSN strips them; they add bloat |
| No `<script>` tags | WordPress sanitizes these out anyway |
| No `srcset` or `sizes` on `<img>` | MSN feed needs predictable image URLs |
| Every `<img>` must have `alt` and `title` | MSN requires alt text; improves SEO |
| All image `src` URLs must be local (on the WordPress domain) | External URLs won't be in the Media Library |
| 800-1500+ words | MSN content quality threshold |
| No base64-encoded images | Upload them as real files via the media endpoint |

### Step 4: Create the post

```http
POST https://{site-url}/wp-json/wp/v2/posts
Authorization: Basic {credentials}
Content-Type: application/json

{
  "title": "10 Best Dog Breeds for First-Time Owners",
  "content": "<p>Opening paragraph...</p><h2>Section...</h2>...",
  "status": "publish",
  "featured_media": 42,
  "categories": [1],
  "excerpt": "A short summary for SEO meta description (1-2 sentences)."
}
```

**Response:**
```json
{
  "id": 123,
  "status": "publish",
  "link": "https://site.kinsta.cloud/10-best-dog-breeds-for-first-time-owners/",
  "featured_media": 42
}
```

**Field reference:**

| Field | Required | Notes |
|---|---|---|
| `title` | Yes | The article headline |
| `content` | Yes | Full HTML body (built in Step 3) |
| `status` | Yes | Use `"publish"` for immediate publish, `"draft"` to save without publishing |
| `featured_media` | Yes | The media `id` from Step 1. Without this, the mu-plugin reverts to draft |
| `categories` | No | Array of category IDs. Default is `[1]` (Uncategorized) |
| `excerpt` | No | Short summary; Rank Math uses this for meta description if set |
| `slug` | No | Auto-generated from title if not provided |

### Step 5: Verify the publish

```http
GET https://{site-url}/wp-json/wp/v2/posts/123
Authorization: Basic {credentials}
```

Check that `status` is `"publish"`. If it's `"draft"`, the featured image requirement mu-plugin caught it — the featured image wasn't properly attached.

---

## What WordPress Does Automatically (don't replicate)

Once the post is created with `status: "publish"`, the WordPress site handles everything else. Here's exactly what fires and why SynthPress does NOT need to do any of this:

### `auto-enable-msn-syndication.php` (mu-plugin)

Fires on `transition_post_status`. Sets these meta fields on every new publish:

| Meta key | Value | Purpose |
|---|---|---|
| `syndication_tool_enabled` | `1` | Includes post in MSN feed |
| `syndication_tool_schema_types` | `['article']` | Sets MSN content type |
| `syndication_tool_ai_disclosure_enable` | `1` | Injects AI disclosure into feed |
| `syndication_tool_backlink_enable` | `1` | Adds source backlink to syndicated content |

**SynthPress does NOT need to send these meta fields.** The mu-plugin handles it.

### `featured-image-requirement.php` (mu-plugin)

Fires on `save_post`. If a post is published without a `featured_media`, it reverts to `draft`. This is the safety net — SynthPress should always upload the featured image first (Step 1) and pass its ID, but if something goes wrong, this prevents broken posts from going live.

### `restrict-author-login.php` (mu-plugin)

Blocks **Author**-role users from logging into wp-admin (unless an admin enables per-user access). The SynthPress bot should use the **Editor** role (`synthpress-bot`); Application Passwords provide REST access without wp-admin. This mu-plugin does **not** block REST API requests.

### `msn-syndication-2` (plugin)

Generates the MSN-compliant RSS feed at `/feed/msn:article`. Includes `<media:content>`, `<dc:creator>`, AI disclosure text, and backlinks per MSN spec. MSN's crawler picks up new posts every few minutes.

### `seo-by-rank-math` (plugin)

Auto-injects Article/NewsArticle schema, generates the sitemap, and handles meta tags. If SynthPress provides an `excerpt`, Rank Math uses it for the meta description.

### `auto-image-attributes-from-filename-with-bulk-updater` (plugin)

Auto-fills alt text from the image filename on upload. This is a backup — SynthPress should set proper alt text, but if it's missed, this plugin catches it from the filename (e.g., `golden-retriever-puppy.jpg` → alt: `Golden Retriever Puppy`).

### `disable-comments` (plugin)

Comments are disabled site-wide. No comment moderation needed.

### `user-role-editor` (plugin)

Fine-grained capability control for the bot user. Ensures the Editor role has exactly the permissions needed.

### Kinsta cache

Auto-purges on content update. The post is live on the public site immediately after publishing.

---

## Error Handling

SynthPress should handle these cases:

| Scenario | How to detect | How to handle |
|---|---|---|
| Bad credentials | `401` on any API call | Mark project as disconnected, prompt user to update credentials |
| Image upload fails | Non-`201` response on media endpoint | Retry once, then mark article as `failed` with error message |
| Post reverted to draft | `GET /posts/{id}` returns `status: "draft"` after publishing | Featured image wasn't attached properly — check `featured_media` was set |
| WordPress unreachable | Network timeout / `5xx` | Retry with exponential backoff (3 attempts), then mark as `failed` |
| Duplicate post | `200` but content already exists | Check by title before publishing, or accept and let the user handle it |
| Rate limiting | `429` response | Back off and retry after the `Retry-After` header value |

---

## Image Requirements Summary

| Requirement | Details |
|---|---|
| Format | JPEG preferred; PNG and WebP also work |
| Minimum size | 1200x800px recommended (MSN displays large) |
| Featured image | Mandatory — upload first, pass `id` as `featured_media` |
| Filename | Descriptive, hyphenated (e.g., `best-running-shoes-2026.jpg`) |
| Alt text | Set by SynthPress at generation time; plugin fills from filename as backup |
| Local URLs only | Every `<img src>` in the post body must point to the WordPress domain |
| No base64 | Upload as real files via `/wp-json/wp/v2/media` |
| No `srcset` / `sizes` | Keep `<img>` tags simple for MSN feed compatibility |

---

## Minimum Viable Publish (aligned with current app)

The implementation lives in `apps/web/src/services/wordpress-publish-service.ts`. Modes: `create_draft` (POST), `update_draft` (PUT), `publish_live` (PUT with `status: "publish"`).

```typescript
// Simplified — see wordpress-publish-service.ts for full error handling
async function syncArticleToWordPress(mode: "create_draft" | "update_draft" | "publish_live") {
  const auth = buildBasicAuthHeader(wpUsername, wpAppPassword);

  const featuredMediaId = await ensureFeaturedMediaUploaded(/* ... */);
  const sectionImagesByKey = await ensureSectionMediaUploaded(/* ... */);
  const html = markdownToHtml(article.content_markdown, { sectionImagesByKey });
  const publishingMeta = await resolvePublishingMetaForPost(/* categories, tags, author */);

  const payload = buildWordPressPayload(article, html, mode === "publish_live" ? "publish" : "draft", featuredMediaId, publishingMeta);

  const method = mode === "create_draft" ? "POST" : "PUT";
  const endpoint = mode === "create_draft" ? "/wp-json/wp/v2/posts" : `/wp-json/wp/v2/posts/${wpPostId}`;
  const post = await performWordPressRequest(endpoint, method, payload, auth);
  // Stamp wp_post_id / wp_post_url; publish_live also sets local article status published
}
```

---

## Quick Reference: All REST API Endpoints Used

| Action | Method | Endpoint | When |
|---|---|---|---|
| Test connection | GET | `/wp-json/wp/v2/users/me?context=edit` | **Connections** tab → **Test connection** button (saved credentials only) |
| Upload image | POST | `/wp-json/wp/v2/media` | Featured + section images before post sync |
| Update media alt | PUT | `/wp-json/wp/v2/media/{id}` | Optional after upload |
| Create draft | POST | `/wp-json/wp/v2/posts` | `create_draft` / autopilot auto-send |
| Update draft | PUT | `/wp-json/wp/v2/posts/{id}` | `update_draft` |
| Publish live | PUT | `/wp-json/wp/v2/posts/{id}` | `publish_live` from article page |
| Categories / tags | GET, POST | `/wp-json/wp/v2/categories`, `/tags` | Resolve blog publishing defaults |
| Authors | GET | `/wp-json/wp/v2/users` | Resolve `defaultAuthor` by slug/search |
