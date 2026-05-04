# WordPress Content (`wp-content`)

Source of truth for the `wp-content` folder deployed across all SynthPress WordPress sites on Kinsta. Every site in the network runs an identical copy of this directory.

---

## MU-Plugins (auto-loaded, no activation needed)

| File | Purpose |
|---|---|
| `auto-enable-msn-syndication.php` | Sets MSN syndication meta on every new publish (feed inclusion, schema type, AI disclosure, backlink) |
| `featured-image-requirement.php` | Blocks publishing without a featured image — reverts to draft as a safety net |
| `restrict-author-login.php` | Prevents bot/Author-role users from accessing wp-admin (REST API only) |
| `kinsta-mu-plugins.php` + `kinsta-mu-plugins/` | Kinsta's cache, CDN, and platform integration — do not modify |

## Plugins

| Plugin | Source | Purpose |
|---|---|---|
| `confleko-2/` | Custom | AI content connector — rehost external images to Media Library, rewrite URLs, fill alt/title |
| `msn-syndication-2/` | Custom | MSN-compliant RSS feed generator at `/feed/msn:article` and `/feed/msn:gallery` |
| `seo-by-rank-math/` | WordPress.org | SEO, Article/NewsArticle schema, sitemap, meta tags |
| `auto-image-attributes-from-filename-with-bulk-updater/` | WordPress.org | Auto-fills alt text from image filenames on upload |
| `disable-comments/` | WordPress.org | Disables comments site-wide (no moderation needed on autopilot sites) |
| `user-role-editor/` | WordPress.org | Fine-grained capability control for the bot user |

## Themes

| Theme | Role |
|---|---|
| `twentytwentyfive/` | Active theme (stock WordPress, no child theme needed) |
| `twentytwentyfour/` | Fallback theme (kept for emergency recovery) |

## Uploads

The `uploads/` directory is **gitignored** — it contains environment-specific media files that differ per site.

---

## Deploying to a New Site

Copy this `wp-content/` folder into a fresh Kinsta WordPress install, then follow the [Kinsta Setup Playbook](../docs/KINSTA-SETUP-PLAYBOOK.md) for activation and configuration steps.
