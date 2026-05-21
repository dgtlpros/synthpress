# WordPress `wp-content` deploy kit

This directory is the **deployable half** of the SynthPress WordPress boilerplate. The full setup guide (minimal REST vs Kinsta/MSN kit, app behavior, checklists, safety) lives in the parent doc:

**→ [../README.md](../README.md)** (start here)

---

## What this folder is

- Tracked **`wp-content`** copied onto **fresh** WordPress installs (especially Kinsta MSN network sites).
- **Canonical source of truth:** `wordpress/` in the monorepo — **not** `wordpress-devkinsta/`, which is a local DevKinsta copy and may contain uploads, site-only plugins, or experiments.

SynthPress publishes via **stock REST API + Application Passwords**. No custom SynthPress plugin is required for MVP publishing.

---

## Deploying to a new site

**Safe on a fresh install** (empty `uploads/`):

- `uploads/` and `upgrade/` ship as empty placeholders (`.gitkeep`)
- `kinsta-mu-plugins/` included for Kinsta hosts
- Plugins and themes are in place

```bash
# From monorepo root — fresh site only
cp -r wordpress/wp-content/ /path/to/site/wp-content/
```

**Do NOT** replace `wp-content/` on a **live** site with existing content — that deletes `uploads/` (all media) and can reset plugin settings. On live sites, copy only the folders you intend to update.

After copying:

1. Activate the **five plugins** below.
2. Activate **Twenty Twenty-Five**.
3. **Settings → Permalinks → Save** (MSN feed rewrites).
4. Follow [../../docs/KINSTA-SETUP-PLAYBOOK.md](../../docs/KINSTA-SETUP-PLAYBOOK.md) for MSN, Rank Math, and bot user setup.

---

## Plugin activation checklist

Activate in WP Admin → Plugins:

- [ ] **MSN Syndication Feeds** (`msn-syndication-2/`)
- [ ] **Rank Math SEO** (`seo-by-rank-math/`)
- [ ] **Auto Image Attributes From Filename With Bulk Updater**
- [ ] **Disable Comments**
- [ ] **User Role Editor**
- [ ] **SynthPress** (`synthpress/`) — optional but recommended; adds Settings → SynthPress with readiness checks + connection-package export

MU-plugins in `mu-plugins/` load automatically (no activation).

---

## MU-plugins (auto-loaded)

| File | Purpose |
|------|---------|
| `auto-enable-msn-syndication.php` | MSN syndication meta when a post first becomes `publish` |
| `featured-image-requirement.php` | Blocks `publish`/`future` without featured image → reverts to `draft` |
| `restrict-author-login.php` | Blocks **Author**-role wp-admin login unless allowed; **Editor** bot (`synthpress-bot`) is unaffected |
| `kinsta-mu-plugins.php` + `kinsta-mu-plugins/` | Kinsta cache/CDN — do not modify; Kinsta hosting only |

---

## Plugins (custom + bundled)

| Plugin | Purpose |
|--------|---------|
| `synthpress/` | **SynthPress connector (first-party).** Settings → SynthPress: readiness checklist, bot-user detection, Application Password setup steps, connection-package JSON export, and an authenticated read-only `/wp-json/synthpress/v1/readiness` endpoint. **Optional** — minimal REST publishing still works without it; **recommended** for faster, more auditable setup. |
| `msn-syndication-2/` | MSN RSS: `/feed/msn:article`, `/feed/msn:gallery` |
| `seo-by-rank-math/` | SEO, Article schema, sitemap |
| `auto-image-attributes-from-filename-with-bulk-updater/` | Alt text from filename on REST uploads |
| `disable-comments/` | Comments off site-wide |
| `user-role-editor/` | Least-privilege tuning for `synthpress-bot` |

---

## Themes

| Theme | Role |
|-------|------|
| `twentytwentyfive/` | Active theme (stock; no child theme in this repo) |
| `twentytwentyfour/` | Fallback |

---

## Other directories

| Directory | Purpose |
|-----------|---------|
| `uploads/` | Per-site media (gitignored except `.gitkeep`) |
| `upgrade/` | WordPress update scratch space |

---

## Minimal REST-only sites

If you only need SynthPress draft publishing and **not** MSN/Rank Math/Kinsta kit behavior, you do **not** need to copy this folder. Connect the site in SynthPress with an Editor user + Application Password. See [../README.md § Path A](../README.md#3-two-supported-setup-paths).
