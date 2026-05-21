# SynthPress WordPress Boilerplate

Canonical **wp-content site kit** for WordPress sites that integrate with the SynthPress dashboard for AI-assisted blogging. This folder is the **source of truth** for how we prepare WordPress installs in the monorepo.

**Related docs (repo root):**

- [Publishing API spec](../docs/PUBLISHING-API-SPEC.md) — REST fields, image rules, error handling
- [Kinsta MSN setup playbook](../docs/KINSTA-SETUP-PLAYBOOK.md) — Kinsta + MSN Partner Hub end-to-end
- [wp-content deploy kit](./wp-content/README.md) — what to copy and activate

---

## 1. Purpose

- **`wordpress/`** is the SynthPress WordPress boilerplate: a tracked `wp-content` tree (plugins, mu-plugins, themes) you deploy onto fresh WordPress installs.
- SynthPress publishes articles via the **stock WordPress REST API** and **Application Passwords**. The bundled **`synthpress/` companion plugin** is **optional but recommended** — it adds a Settings → SynthPress page with a readiness checklist and a one-click connection-package export, but does not change how publishing works.
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

**SynthPress connection (recommended path, using the bundled companion plugin):**

1. Install/activate the **SynthPress** plugin (ships with this kit at `wordpress/wp-content/plugins/synthpress/`).
2. Open **Settings → SynthPress** in WP Admin. Fix any failing readiness rows. Confirm or create the `synthpress-bot` user.
3. Generate an Application Password named `SynthPress` on the bot user's profile. Copy the password WordPress shows you exactly once.
4. Click **Copy connection package** on the plugin page.
5. In SynthPress → **Connections**, click **Paste connection package** → paste the JSON → click **Review package** → click **Use this connection**. The site URL and a suggested username pre-fill from the package. The package never contains your Application Password.
6. Paste the Application Password into the dashboard's password field.
7. Click **Save**, then **Test connection** — the dashboard runs `GET /wp-json/wp/v2/users/me?context=edit` against the saved credentials (not unsaved form values) and renders one of three panels:
   - **Connection looks healthy** — green; user + role + capabilities returned by WordPress.
   - **Connected with warnings** — amber; the user authenticated, but the capability map suggests they can't publish, upload media, or create categories/tags. Autopilot drafts will still work; live publish may not.
   - **Connection failed** — red; mapped error code with a friendly message (bad credentials, REST 404 at `/wp-json`, network error, etc.). The application password is never echoed back to the browser by the test action.

**Manual path (no companion plugin):** skip steps 1–2 and 4 above; enter the WordPress URL by hand in step 5 (skip the package import), then continue with Save + Test connection. The companion plugin is a setup convenience, not a requirement.

**You do not need to copy `wordpress/wp-content`** for Path A — the companion plugin can be installed standalone from a release zip if you don't want the full Kinsta/MSN kit.

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
| In-app connection test (`GET /users/me`) | **Yes** — Connections tab → **Test connection** button; uses saved credentials and renders healthy / warnings / error panels |
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
| `synthpress/` | **SynthPress connector (first-party)** — Settings → SynthPress with readiness checklist, bot user detection, App Password setup steps, and a connection-package JSON export. Authenticated read-only REST route `/wp-json/synthpress/v1/readiness`. No remote calls, no options stored, no secrets handled. |
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

**Preferred:** in SynthPress, open the blog → **Connections** tab → click **Test connection**. The dashboard calls `GET /wp-json/wp/v2/users/me?context=edit` with Basic auth using the saved credentials and shows:

- **Connection looks healthy** — credentials work, user has the capabilities autopilot needs.
- **Connected with warnings** — credentials work, but the user may not be able to publish, upload media, or create categories/tags. Drafts still flow; live publish may fail.
- **Connection failed** — one of `missing_url`, `missing_username`, `missing_password`, `invalid_url`, `unauthorized` (401), `forbidden` (403), `rest_not_found` (404 — wrong site URL or REST disabled), `not_wordpress` (response wasn't a WP user payload), `network_error`, or `unexpected` (other 5xx).

The app password is read server-side and **never** returned to the browser by the test action — only the test result, capability map, and error code travel back to the client.

**Out-of-band check** (useful when triaging a 401 outside the dashboard):

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

## 9. Companion plugin (`synthpress/`)

The first version of the **SynthPress companion plugin** now ships in `wp-content/plugins/synthpress/`. Scope is intentionally minimal — it is a setup-helper, not a publishing layer.

**What it does today (v0.1.0):**

- Adds **Settings → SynthPress** (visible only to `manage_options`).
- Runs a readiness checklist: REST API reachable, Application Passwords supported, HTTPS, pretty permalinks, current-user capability gates (`edit_posts` / `publish_posts` / `upload_files` / `manage_categories`), and `synthpress-bot` user detection.
- Tells you exactly how to generate an Application Password named `SynthPress`; never stores or displays the password itself.
- Provides a read-only **connection package** JSON (site URL, REST URL, admin URL, WordPress version, recommended user, readiness snapshot) with a Copy-to-clipboard button.
- Registers `GET /wp-json/synthpress/v1/readiness` (authenticated — `edit_posts` or `manage_options`) so a future SynthPress app version can pre-flight a connection without scraping HTML.

**What it deliberately does not do:**

- No custom auth layer — Application Passwords stay the only credential.
- No write endpoints, no AI inside WordPress, no Rank Math / MSN / scheduling sync.
- No outbound HTTP calls. No options stored. No telemetry.
- No app-password / bot-user creation on the admin's behalf — every step is performed by the admin in WordPress core UI.

**Dashboard support (shipped):**

- The SynthPress Connections form has an **Import connection package** section. Paste the JSON the plugin exports, click **Review package**, then **Use this connection** to pre-fill the WordPress URL and suggest the `synthpress-bot` username (only if the plugin reported the bot user exists). The Application Password is **always** pasted separately — the package never contains secrets, and the import flow never touches the password field. Parser source: [`apps/web/src/lib/wordpress-connection-package.ts`](../apps/web/src/lib/wordpress-connection-package.ts).

**Roadmap (not implemented yet, mentioned for context):**

- Deep-link button from the WP plugin to the SynthPress Connections page (URL fragment, still no remote call from WP).
- Optional bot-user / Application Password creation wizards in the plugin.
- App-side pre-flight against `/synthpress/v1/readiness`.
- Optional Rank Math / SEO meta sync and post-publish callbacks (separately scoped review).

For plugin internals, see [wordpress/wp-content/plugins/synthpress/readme.txt](./wp-content/plugins/synthpress/readme.txt).

---

## Deploying wp-content

From the monorepo root (fresh site example):

```bash
cp -r wordpress/wp-content/ /path/to/site/wp-content/
```

On DevKinsta local sites, the target is often under `~/DevKinsta/public/{site}/app/public/wp-content/`. That local tree is **not** authoritative — copy **from `wordpress/wp-content/`** only.

For plugin-level detail and activation order, see [wp-content/README.md](./wp-content/README.md).
