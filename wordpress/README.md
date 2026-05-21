# SynthPress WordPress Boilerplate

Canonical **wp-content site kit** for WordPress sites that integrate with the SynthPress dashboard for AI-assisted blogging. This folder is the **source of truth** for how we prepare WordPress installs in the monorepo.

**Related docs (repo root):**

- [Publishing API spec](../docs/PUBLISHING-API-SPEC.md) — REST fields, image rules, error handling
- [Kinsta MSN setup playbook](../docs/KINSTA-SETUP-PLAYBOOK.md) — Kinsta + MSN Partner Hub end-to-end
- [wp-content deploy kit](./wp-content/README.md) — what to copy and activate

---

## 1. Purpose

- **`wordpress/`** is the SynthPress WordPress boilerplate: a tracked `wp-content` tree (plugins, mu-plugins, themes) you deploy onto fresh WordPress installs.
- SynthPress publishes articles via the **stock WordPress REST API** and **Application Passwords**. **No custom SynthPress companion plugin is required** for MVP.
- This kit is **especially useful** for the documented **Kinsta + MSN syndication** network (RSS feeds, SEO plugins, publish-time guardrails).
- For **basic draft/live publishing only**, you can connect any compatible WordPress site in SynthPress without copying this folder.

---

## 2. Source of truth

| Path | Role |
|------|------|
| **`wordpress/`** | **Authoritative** boilerplate. Changes here are intentional and reviewable. |
| **`wordpress-devkinsta/`** | **Local/dev only.** May contain site-specific plugins (e.g. legacy experiments), generated uploads, Rank Math cache files, or other artifacts. **Do not** treat it as the boilerplate or copy from it into `wordpress/` without review. |

If something in DevKinsta should become part of the kit, **copy it into `wordpress/` deliberately** (PR + review), not by syncing the whole local tree.

---

## 3. Two supported setup paths

### Path A — Minimal REST setup (any WordPress site)

Use this when you already have WordPress and only need SynthPress to create/update drafts (and optionally publish live from the article page).

**Requirements:**

- WordPress **6.x+**, PHP **8.2+** recommended
- REST API enabled (default on modern WordPress)
- Permalinks: **Post name** recommended (`/%postname%/`)
- Bot user (e.g. **`synthpress-bot`**), role **Editor**
- **Application Password** for that user (`Users → Profile → Application Passwords`)
- Capabilities: create/edit/publish posts, upload media; create categories/tags; assign author as allowed by your site policy

**SynthPress connection:**

1. Open the blog in SynthPress → **Connections** (or blog settings).
2. Enter **WordPress URL** (site root or full `/wp-json` base if non-standard).
3. Enter **username** and **application password** (spaces in the password are stripped on save).
4. Save. The dashboard does **not** yet run an automatic `GET /wp/v2/users/me` health check — verify manually (see [Testing the connection](#testing-the-connection) below).

**You do not need to copy `wordpress/wp-content`** for Path A.

### Path B — Full SynthPress / Kinsta / MSN boilerplate

Use this for a **new** site that should match the network template (MSN feeds, Rank Math, mu-plugin guardrails, Kinsta integration).

**High-level steps:**

1. Start from a **fresh** WordPress install (Kinsta or other host).
2. Set PHP **8.2+**, permalinks to **Post name**.
3. Copy **`wordpress/wp-content/`** into the site’s `wp-content/`, **without overwriting** an existing `uploads/` tree on live sites.
4. Activate the **five plugins** listed in [wp-content/README.md](./wp-content/README.md).
5. Activate **Twenty Twenty-Five** (included; no child theme required in this repo).
6. **Settings → Permalinks → Save** (flushes MSN feed rewrite rules).
7. Configure **MSN Syndication**, **Rank Math**, **Disable Comments**, and bot user per the [Kinsta playbook](../docs/KINSTA-SETUP-PLAYBOOK.md).
8. Create **`synthpress-bot`** (Editor), generate Application Password, connect in SynthPress.
9. Send a **test draft** from SynthPress; optionally **publish live** and verify `/feed/msn:article` if using MSN.

See [New site setup checklist](#7-new-site-setup-checklist) below.

---

## 4. What SynthPress uses through REST

The dashboard (`apps/web/src/services/wordpress-publish-service.ts`) calls:

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Create draft | `POST` | `/wp-json/wp/v2/posts` (`status: "draft"`) |
| Update draft | `PUT` | `/wp-json/wp/v2/posts/{id}` (`status: "draft"`) |
| Publish live | `PUT` | `/wp-json/wp/v2/posts/{id}` (`status: "publish"`) |
| Upload media | `POST` | `/wp-json/wp/v2/media` |
| Set alt text (optional) | `PUT` | `/wp-json/wp/v2/media/{id}` |
| Resolve category | `GET` / `POST` | `/wp-json/wp/v2/categories` |
| Resolve tags | `GET` / `POST` | `/wp-json/wp/v2/tags` |
| Resolve author | `GET` | `/wp-json/wp/v2/users?slug=` / `?search=` |

Auth: `Authorization: Basic` with username + application password.

**Not sent today:** custom post meta, Rank Math fields, MSN `syndication_tool_*` meta (WordPress sets MSN meta on live publish via mu-plugin when using this kit).

---

## 5. Current app behavior

| Behavior | Status |
|----------|--------|
| Create / update **WordPress drafts** from article page | Yes |
| **Publish live** to WordPress from article page | Yes |
| **Autopilot** auto-send to WordPress | **Draft only** (`autoSendToWordPressDraft`); never auto live-publish |
| **Featured image** | Uploaded to WP media when configured; `featured_media` on post |
| **Section images** (per H2) | Uploaded to WP media; injected as `<figure class="synthpress-section-image">` with `wp-image-{id}` |
| **Inline markdown images** (`![alt](url)`) | Stay as **external URLs** in HTML; **not** uploaded to WP media |
| Blog setting `defaultStatus` / `updateExistingPosts` | Stored in UI; **not wired** into publish payload yet |
| In-app connection test (`GET /users/me`) | **Not implemented** — test manually |
| MSN syndication meta from SynthPress | **No** — set by `auto-enable-msn-syndication.php` when post becomes `publish` on sites using this kit |

MSN feed inclusion only matters after a post is **published** on WordPress (not while it remains a draft).

---

## 6. Included boilerplate components

Deployable under [`wp-content/`](./wp-content/):

### MU-plugins (auto-loaded)

| File | Purpose |
|------|---------|
| `auto-enable-msn-syndication.php` | On first transition to `publish`, sets MSN syndication post meta |
| `featured-image-requirement.php` | Reverts `publish`/`future` posts without featured image to `draft` |
| `restrict-author-login.php` | Blocks **Author**-role users from wp-admin (REST unaffected); SynthPress bot should use **Editor** |
| `kinsta-mu-plugins/` | Kinsta hosting integration — **Kinsta-only**; omit on other hosts |

### Plugins (activate after copy)

| Folder | Purpose |
|--------|---------|
| `msn-syndication-2/` | MSN RSS at `/feed/msn:article`, `/feed/msn:gallery` |
| `seo-by-rank-math/` | SEO, schema, sitemap |
| `auto-image-attributes-from-filename-with-bulk-updater/` | Alt text from upload filename |
| `disable-comments/` | Site-wide comment disable |
| `user-role-editor/` | Fine-tune bot capabilities |

### Themes

| Theme | Role |
|-------|------|
| `twentytwentyfive/` | Intended active theme (stock, unmodified) |
| `twentytwentyfour/` | Fallback / recovery |

---

## 7. New site setup checklist

### Fresh site (Path B)

- [ ] Install WordPress; PHP **8.2+**
- [ ] Permalinks → **Post name** → Save
- [ ] Copy `wordpress/wp-content/` → site `wp-content/` (fresh site only, or cherry-pick folders)
- [ ] Confirm **`uploads/` was not overwritten** on any site with existing media
- [ ] Activate: MSN Syndication, Rank Math, Auto Image Attributes, Disable Comments, User Role Editor
- [ ] Activate **Twenty Twenty-Five**
- [ ] Rank Math wizard / Article schema defaults
- [ ] **Settings → Syndication Tool** — AI disclosure + backlink if using MSN
- [ ] Permalinks → Save again (MSN rewrite rules)
- [ ] Visit `/feed/msn:article` — empty feed OK until posts are published with syndication enabled
- [ ] Create user **`synthpress-bot`**, role **Editor**
- [ ] Generate **Application Password**; store in SynthPress only (never commit)
- [ ] Connect blog in SynthPress; send **test draft**
- [ ] Optional: **Publish live** on WordPress; confirm post in MSN feed and featured image present
- [ ] Optional: article with **section images** — confirm `<figure class="synthpress-section-image">` in WP content

### Existing site (Path A only)

- [ ] Skip copying `wp-content` unless you intentionally adopt MSN kit pieces
- [ ] Create Editor bot + Application Password
- [ ] Connect in SynthPress; test draft

### Testing the connection

Until the dashboard ships an in-app check, verify manually:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -u 'synthpress-bot:YOUR_APP_PASSWORD' \
  'https://your-site.example/wp-json/wp/v2/users/me'
```

Expect `200`. `401` = bad credentials.

---

## 8. Safety warnings

- **Never overwrite production `wp-content/uploads/`** when copying the boilerplate — you will delete all media.
- Use **Editor** (or a custom least-privilege role) for the bot — avoid **Administrator** unless absolutely necessary.
- **Never commit** real application passwords or `.env` secrets.
- **`wordpress-devkinsta/` is not the boilerplate** — do not sync it back into `wordpress/` blindly.
- **`kinsta-mu-plugins/`** only applies on Kinsta managed hosting.
- Live publish without a featured image on kit-enabled sites will be **reverted to draft** by `featured-image-requirement.php`.

---

## 9. Future companion plugin

No SynthPress companion plugin is required today. One may be added later if we need:

- Custom REST endpoints or webhooks (WP → SynthPress)
- Rank Math / SEO meta sync from the dashboard
- Scheduled publish hooks or status sync
- Site telemetry or health callbacks

Until then, keep integration in the dashboard service layer + this wp-content kit.

---

## Deploying wp-content

From the monorepo root (fresh site example):

```bash
cp -r wordpress/wp-content/ /path/to/site/wp-content/
```

On DevKinsta local sites, the target is often under `~/DevKinsta/public/{site}/app/public/wp-content/`. That local tree is **not** authoritative — copy **from `wordpress/wp-content/`** only.

For plugin-level detail and activation order, see [wp-content/README.md](./wp-content/README.md).
