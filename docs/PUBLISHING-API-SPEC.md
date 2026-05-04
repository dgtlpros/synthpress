# SynthPress Publishing API — Integration Spec

> **Purpose**: This is the definitive reference for how the SynthPress Dashboard publishes content to WordPress sites. It documents every API call, the exact order of operations, content formatting rules, and what WordPress handles automatically so we never duplicate work.

---

## Overview

SynthPress publishes to WordPress using **only the built-in REST API**. No custom WordPress plugin is required. The WordPress site has mu-plugins and standard plugins that handle everything post-publish (MSN syndication, SEO, cache purge).

```
SynthPress Dashboard
  │
  │  1. Upload featured image ──► POST /wp-json/wp/v2/media
  │  2. Upload inline images ───► POST /wp-json/wp/v2/media (repeat per image)
  │  3. Build HTML with local URLs
  │  4. Create post ────────────► POST /wp-json/wp/v2/posts
  │  5. Verify publish ────────► GET  /wp-json/wp/v2/posts/{id}
  │
  ▼
WordPress (autopilot from here)
  ├── auto-enable-msn-syndication.php sets syndication meta
  ├── featured-image-requirement.php blocks posts without images
  ├── msn-syndication-2 adds post to /feed/msn:article
  ├── Rank Math injects Article schema + sitemap
  ├── Auto Image Attributes fills alt text from filename
  └── Kinsta purges cache → post is live
```

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

### Testing the connection

```
GET https://{site-url}/wp-json/wp/v2/users/me
Authorization: Basic {credentials}
```

A `200` response with the bot user's data = connection works. A `401` = bad credentials.

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

### Step 2: Upload inline images (if any)

If the article has images in the body (not just the featured image), upload each one the same way:

```http
POST https://{site-url}/wp-json/wp/v2/media
Authorization: Basic {credentials}
Content-Type: image/jpeg
Content-Disposition: attachment; filename="descriptive-image-name.jpg"

{binary image data}
```

Collect the `source_url` from each response. You'll use these when building the HTML.

### Step 3: Build the article HTML

Construct the post body using **only local WordPress URLs** for images. Never include external URLs — every image must already be in the WordPress Media Library from Steps 1-2.

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

Blocks the bot user from logging into wp-admin. The bot only needs REST API access, which Application Passwords provide. This is a security hardening measure.

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

## Minimum Viable Publish (code pseudocode)

```typescript
async function publishArticle(project: Project, article: Article) {
  const auth = btoa(`${project.wpUsername}:${project.wpAppPassword}`);
  const headers = { Authorization: `Basic ${auth}` };

  // Step 1: Upload featured image
  const imageResponse = await fetch(`${project.wpUrl}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="${article.featuredImageFilename}"`,
    },
    body: article.featuredImageBuffer,
  });
  const media = await imageResponse.json();

  // Step 2: Upload inline images and rewrite URLs in content
  let content = article.htmlContent;
  for (const image of article.inlineImages) {
    const inlineResponse = await fetch(`${project.wpUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": image.mimeType,
        "Content-Disposition": `attachment; filename="${image.filename}"`,
      },
      body: image.buffer,
    });
    const inlineMedia = await inlineResponse.json();
    content = content.replace(image.placeholderUrl, inlineMedia.source_url);
  }

  // Step 3: Create the post
  const postResponse = await fetch(`${project.wpUrl}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: article.title,
      content: content,
      status: "publish",
      featured_media: media.id,
      excerpt: article.excerpt,
    }),
  });
  const post = await postResponse.json();

  // Step 4: Verify
  if (post.status !== "publish") {
    throw new Error(`Post ${post.id} was not published — status: ${post.status}`);
  }

  return {
    wpPostId: post.id,
    wpPostUrl: post.link,
    publishedAt: new Date(),
  };
}
```

---

## Quick Reference: All REST API Endpoints Used

| Action | Method | Endpoint | When |
|---|---|---|---|
| Test connection | GET | `/wp-json/wp/v2/users/me` | On project setup / health check |
| Upload image | POST | `/wp-json/wp/v2/media` | Before creating each post |
| Create post | POST | `/wp-json/wp/v2/posts` | After all images are uploaded |
| Verify post | GET | `/wp-json/wp/v2/posts/{id}` | After creating the post |
| List categories | GET | `/wp-json/wp/v2/categories` | On project setup (to map categories) |
| Create category | POST | `/wp-json/wp/v2/categories` | If a needed category doesn't exist |
| List posts | GET | `/wp-json/wp/v2/posts` | For dashboard article history / sync |
| Site info | GET | `/wp-json/` | On project setup (verify REST API is available) |
