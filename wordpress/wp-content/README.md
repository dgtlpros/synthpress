# WordPress Content (`wp-content`)

Source of truth for the `wp-content` folder deployed across all SynthPress WordPress sites on Kinsta. Every site in the network runs an identical copy of this directory.

The SynthPress Dashboard publishes content via the WordPress REST API using a bot user with an Application Password. No custom WordPress plugin is needed for the publishing pipeline — the mu-plugins and standard plugins below handle everything on the WordPress side.

---

## Deploying to a New Site

**Copy this entire `wp-content/` folder** into a fresh Kinsta WordPress install, replacing the default one. This is safe on a fresh site because:

- `uploads/` is included as an empty directory (ready for media)
- `upgrade/` is included as an empty directory (WordPress uses this for updates)
- `kinsta-mu-plugins/` is included (Kinsta's platform integration)
- All plugins and themes are in place

```bash
# From the monorepo root — replace the fresh site's wp-content
cp -r wordpress/wp-content/ ~/DevKinsta/public/{site-name}/app/public/wp-content/
```

After copying, activate the 5 plugins in WP Admin and follow the [Kinsta Setup Playbook](../docs/KINSTA-SETUP-PLAYBOOK.md) for the rest of the configuration.

**Do NOT overwrite `wp-content/` on a live site with existing content** — that would delete the `uploads/` folder (all media) and could break plugin settings. For existing sites, copy only the specific files you need to update.

---

## MU-Plugins (auto-loaded, no activation needed)

| File | Purpose |
|---|---|
| `auto-enable-msn-syndication.php` | Sets MSN syndication meta on every new publish (feed inclusion, schema type, AI disclosure, backlink) |
| `featured-image-requirement.php` | Blocks publishing without a featured image — reverts to draft as a safety net |
| `restrict-author-login.php` | Prevents bot/Author-role users from accessing wp-admin (REST API only) |
| `kinsta-mu-plugins.php` + `kinsta-mu-plugins/` | Kinsta's cache, CDN, and platform integration — do not modify |

## Plugins (activate in WP Admin after copying)

| Plugin | Source | Purpose |
|---|---|---|
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

## Other Directories

| Directory | Purpose |
|---|---|
| `uploads/` | Empty — WordPress stores media here per-site (gitignored, not tracked) |
| `upgrade/` | Empty — WordPress uses this for plugin/theme updates |
