# Kinsta MSN Autopilot Site — Setup Playbook

> **Purpose**: Complete setup for one "golden template" WordPress site on Kinsta: SynthPress Dashboard → WordPress → MSN Partner Hub. Clone across the network once validated.
>
> **Boilerplate source of truth:** Copy from **`wordpress/wp-content/`** in this monorepo — see **[`wordpress/README.md`](../wordpress/README.md)**. Do **not** treat **`wordpress-devkinsta/`** as authoritative (local DevKinsta copy; may include uploads, site-only plugins, or experiments).
>
> **Publishing reference:** **[`PUBLISHING-API-SPEC.md`](./PUBLISHING-API-SPEC.md)** (REST behavior; section images; draft vs live).

---

## The Goal

```
SynthPress Dashboard (Next.js) → WordPress on Kinsta → MSN Partner Hub
                                                      → Public visitors via WP theme
```

- **20 posts/day** across the network (starts with 1 site)
- Standard WordPress frontend (NOT headless)
- MSN auto-publishes from our RSS feed
- SynthPress Dashboard handles AI content generation and pushes via REST API
- Minimal plugin footprint — only what's needed for the pipeline

---

## Phase 1: Manual Steps (Human does these)

### 1.1 Create the site on Kinsta

1. Log into [my.kinsta.com](https://my.kinsta.com)
2. **Add Site → Install WordPress**
3. Settings:
   - Site name: whatever your first niche is (e.g. `petmojo-v2` or your actual domain name)
   - Data center: closest to your audience (or US Central for MSN)
   - WordPress version: latest
   - Admin username: your personal admin (NOT the bot user)
   - Admin email: your email
   - PHP version: 8.2+
4. Once created, go to **Domains → Add Domain** and point your first custom domain
5. Enable **Kinsta CDN** (free, under CDN tab)
6. Under **Tools**: 
   - Enable HTTPS (force redirect)
   - Set PHP version to 8.2+

### 1.2 Pull to DevKinsta

1. Open DevKinsta
2. Connect to your Kinsta account (if not already)
3. Pull the site down to local
4. Note the local folder path — you'll open this in Cursor

### 1.3 Open in Cursor

1. Open the DevKinsta site folder in Cursor
2. Drop this `KINSTA-SETUP-PLAYBOOK.md` file into the project root
3. Tell the AI: "Read KINSTA-SETUP-PLAYBOOK.md and help me set up this site"

---

## Phase 2: Plugin Installation

### Required plugins (5 total)

| Plugin | Source | How to install |
|---|---|---|
| **msn-syndication-2** | This repo: `wordpress/wp-content/plugins/msn-syndication-2/` | Copy folder to site's `wp-content/plugins/` |
| **Rank Math SEO** | WordPress.org (free) | Install from WP Admin → Plugins → Add New |
| **Auto Image Attributes From Filename** | WordPress.org (free) | Install from WP Admin → Plugins → Add New |
| **Disable Comments** | WordPress.org (free) | Install from WP Admin → Plugins → Add New |
| **User Role Editor** | WordPress.org (free) | Install from WP Admin → Plugins → Add New |

### Plugin source files

The custom plugin and all mu-plugins live in this monorepo at:
```
synthpress/wordpress/wp-content/plugins/msn-syndication-2/
synthpress/wordpress/wp-content/mu-plugins/
```

Copy the entire `wp-content` boilerplate into the new site, or cherry-pick the folders you need.

### After installing — activate all 5 plugins

---

## Phase 3: Theme Setup

### 3.1 Theme in this repo

The canonical boilerplate ships **Twenty Twenty-Five** (active) and **Twenty Twenty-Four** (fallback) — stock block themes, no child theme in git.

Other lightweight themes (GeneratePress, etc.) also work if they output clean heading hierarchy for MSN.

### 3.2 MU-plugins vs child theme (important)

**In `wordpress/wp-content/` today**, featured-image enforcement and author login restrictions live as **mu-plugins**, not in a child theme:

- `mu-plugins/featured-image-requirement.php`
- `mu-plugins/restrict-author-login.php`
- `mu-plugins/auto-enable-msn-syndication.php`

You do **not** need to create a child theme for a standard deploy from this boilerplate. Sections **3.3–3.7** below are **legacy reference** only if you maintain a separate child-theme-based site — avoid duplicating the same logic in both places.

### 3.3 Legacy: child theme layout (optional)

If you maintain a child theme on a site that does **not** use the mu-plugins above, the child theme might look like:

```
wp-content/themes/{parent-theme}-child/
├── style.css
├── functions.php
└── inc/
    ├── featured-image-requirement.php
    ├── restrict-author-login.php
    └── user-profile.php (optional — for E-E-A-T author schema)
```

### 3.4 Legacy child theme: `style.css`

```css
/*
Theme Name: {Parent Theme} Child
Template: {parent-theme-slug}
Description: Child theme for MSN autopilot site
Version: 1.0
*/
```

### 3.5 Legacy child theme: `functions.php`

```php
<?php
if (!defined('ABSPATH')) exit;

// Include critical customizations
include_once('inc/featured-image-requirement.php');
include_once('inc/restrict-author-login.php');

// Optional: author schema fields for E-E-A-T
// include_once('inc/user-profile.php');
```

### 3.6 Legacy child theme: `inc/featured-image-requirement.php`

This is CRITICAL — prevents publishing posts without a featured image (MSN requires images for auto-publish).

```php
<?php
if (!defined('ABSPATH')) exit;

function enforce_featured_image_requirement($post_id) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (wp_is_post_revision($post_id) || !current_user_can('edit_post', $post_id)) return;

    $post_types_requiring_featured_image = array('post');
    if (in_array(get_post_type($post_id), $post_types_requiring_featured_image)) {
        if (!has_post_thumbnail($post_id)) {
            $post_status = get_post_status($post_id);
            if ($post_status == 'publish' || $post_status == 'future') {
                wp_update_post(array(
                    'ID' => $post_id,
                    'post_status' => 'draft'
                ));
            }
            set_transient('missing_featured_image_' . $post_id, true, 30);
        }
    }
}
add_action('save_post', 'enforce_featured_image_requirement');

function display_missing_featured_image_notice() {
    global $post;
    if (empty($post) || !isset($post->ID)) return;

    $message = get_transient('missing_featured_image_' . $post->ID);
    if ($message) {
        echo '<div class="notice notice-error is-dismissible"><p><strong>Featured Image Required:</strong> Please set a featured image before publishing this post.</p></div>';
        delete_transient('missing_featured_image_' . $post->ID);
    }
}
add_action('admin_notices', 'display_missing_featured_image_notice');
```

### 3.7 Legacy child theme: `inc/restrict-author-login.php`

Prevents **Author**-role users from accessing wp-admin unless explicitly allowed. The SynthPress bot should use **Editor** (`synthpress-bot`), not Author — see Phase 4.1.

```php
<?php
if (!defined('ABSPATH')) exit;

add_action('show_user_profile', 'add_allowed_author_checkbox');
add_action('edit_user_profile', 'add_allowed_author_checkbox');

function add_allowed_author_checkbox($user) {
    if (current_user_can('administrator') && in_array('author', $user->roles)) {
        ?>
        <h3>Login Access Control</h3>
        <table class="form-table">
            <tr>
                <th><label for="allow_author_login">Allow login</label></th>
                <td>
                    <input type="checkbox" name="allow_author_login" id="allow_author_login" value="yes"
                    <?php checked(get_user_meta($user->ID, 'allow_author_login', true), 'yes'); ?> />
                    <span class="description">Check this box to allow the author to log in to wp-admin.</span>
                </td>
            </tr>
        </table>
        <?php
    }
}

add_action('personal_options_update', 'save_allowed_author_checkbox');
add_action('edit_user_profile_update', 'save_allowed_author_checkbox');

function save_allowed_author_checkbox($user_id) {
    if (current_user_can('administrator')) {
        $user = get_userdata($user_id);
        if (in_array('author', $user->roles)) {
            if (isset($_POST['allow_author_login']) && $_POST['allow_author_login'] === 'yes') {
                update_user_meta($user_id, 'allow_author_login', 'yes');
            } else {
                delete_user_meta($user_id, 'allow_author_login');
            }
        }
    }
}

add_action('wp_login', 'restrict_author_login_on_login', 10, 2);

function restrict_author_login_on_login($user_login, $user) {
    if (isset($user->roles) && is_array($user->roles) && in_array('author', $user->roles) && get_user_meta($user->ID, 'allow_author_login', true) !== 'yes') {
        wp_logout();
        wp_redirect(home_url());
        exit;
    }
}
```

---

## Phase 4: WordPress Configuration

### 4.1 Create the bot user

1. **Users → Add New**
   - Username: `synthpress-bot` (or similar)
   - Email: a dedicated email for this
   - Role: **Editor** (needs `edit_posts`, `publish_posts`, `upload_files`, `edit_others_posts`)
   - Password: anything (won't use password login)

2. **Why Editor and not Author?** The bot needs to be able to set post meta fields (like `syndication_tool_enabled`) which requires `edit_others_posts` or a custom capability. Editor covers this.

### 4.2 Create Application Password for SynthPress

1. Go to **Users → your bot user → Application Passwords**
2. Enter a name (e.g. "SynthPress Dashboard") and click **Add New Application Password**
3. Copy the generated password — you'll store this in the SynthPress Dashboard project settings
4. The dashboard will use HTTP Basic auth: `synthpress-bot:{app-password}`

### 4.3 Configure MSN Syndication

1. Go to **Settings → Syndication Tool**
2. Enable **AI Disclosure** (toggle ON) — MSN requires this for AI-generated content
   - Default text: `"This content was created with the assistance of AI tools and thoroughly edited by a human"`
3. Enable **Post Backlink** (toggle ON) — drives traffic back to your site
   - Template: `<p>The post {{POST_LINK}} appeared first on {{SITE_LINK}}.</p>`

### 4.4 Flush permalinks

1. **Settings → Permalinks** — set to "Post name" (`/%postname%/`)
2. Save (this registers the `/feed/msn:article` and `/feed/msn:gallery` rewrite rules)

### 4.5 Verify the MSN feed works

Visit: `https://your-domain.com/feed/msn:article`

- If you get a blank RSS feed (no items), that's correct — no posts have `syndication_tool_enabled` set yet
- If you get a 404, permalinks aren't flushed — re-save them

### 4.6 Configure Rank Math

1. Run the Rank Math setup wizard
2. Set site type (Blog / News site)
3. Enable: SEO Analysis, Sitemap, Schema (Article)
4. Under **Titles & Meta → Posts**: set default schema to `Article` or `NewsArticle`

### 4.7 Configure Auto Image Attributes

1. **Settings → Image Attributes**
2. Enable: auto-fill alt text from filename on upload
3. This ensures any image uploaded via the REST API gets proper alt text

### 4.8 Configure Disable Comments

1. **Settings → Disable Comments**
2. Select "Everywhere" — disable on all post types

### 4.9 Kinsta-specific settings

1. In Kinsta dashboard → **Tools → Cache**:
   - Enable "Clear cache on content update" (so new posts are live immediately)
2. Under **CDN**: ensure it's active
3. Under **Edge Caching**: enable for global performance

---

## Phase 5: The Autopilot Wiring

### 5.1 How a post flows (the full lifecycle)

**SynthPress dashboard (typical):**

```
1. SynthPress generates an article (manual or autopilot)
2. Optional: autopilot auto-sends WordPress DRAFT (autoSendToWordPressDraft)
3. Dashboard POSTs featured + section images → /wp-json/wp/v2/media
4. Dashboard POST or PUT post → status "draft" (create/update) or "publish" (publish live from article page)
5. Auth: HTTP Basic (synthpress-bot : application password)
```

**WordPress + MSN (when post reaches status `publish`):**

```
6. featured-image-requirement.php — no thumbnail → reverts to draft
7. auto-enable-msn-syndication.php — sets syndication meta on first publish
8. Kinsta cache purge → public site updated
9. MSN crawler → /feed/msn:article (posts with syndication_tool_enabled)
```

Drafts sent from SynthPress do **not** appear in the MSN feed until they are **published** on WordPress (manual publish live in SynthPress or in WP Admin).

### 5.2 MSN meta fields (handled automatically)

The `auto-enable-msn-syndication.php` mu-plugin sets these on every new publish:

```json
{
  "syndication_tool_enabled": true,
  "syndication_tool_schema_types": ["article"],
  "syndication_tool_ai_disclosure_enable": true,
  "syndication_tool_backlink_enable": true
}
```

The SynthPress Dashboard does NOT need to send these — the mu-plugin handles it. Zero manual clicks needed.

---

## Phase 6: MSN Partner Hub Configuration

### 6.1 Add the site to MSN Partner Hub

1. Log into [partner.microsoft.com](https://partner.microsoft.com/) (your existing account)
2. Add a new publication/property for this domain
3. Add feed source: `https://your-domain.com/feed/msn:article`
4. Set content type: **Article**
5. Set language: **English** (or whatever matches)
6. Enable **Auto-publish** (safe because every post has a local image + alt text + AI disclosure)

### 6.2 Optional: add gallery feed

If you'll publish gallery/slideshow content:
- Add second feed: `https://your-domain.com/feed/msn:gallery`
- Content type: **Gallery**

### 6.3 Wait for MSN validation

MSN will crawl your feed and validate. Common checks:
- UTF-8 encoding ✓ (WordPress default)
- HTTPS ✓ (Kinsta forces it)
- Images have alt text ✓ (auto-image-attributes plugin)
- AI disclosure present ✓ (msn-syndication-2 injects it)
- Feed < 10MB ✓ (50 items max, text + image URLs only)
- Content < 365 days old ✓ (fresh posts only)

---

## Phase 7: Testing the Full Pipeline

### Test 1: Manual post with MSN syndication

1. In WP Admin, create a post manually
2. Add content, set a featured image
3. In the editor sidebar, find "Syndication" panel:
   - Toggle "Enable Syndication" ON
   - Check "Article" under schema types
4. Publish
5. Visit `https://your-domain.com/feed/msn:article` — confirm the post appears in the XML
6. Confirm the feed has `<media:content>`, `<dc:creator>`, AI disclosure text

### Test 2: REST API publish (simulating SynthPress Dashboard)

1. In SynthPress: **Send to WordPress draft** — confirm draft in WP Admin (`status: draft`)
2. Upload featured image + section images land in Media Library
3. **Publish to WordPress** (live) from SynthPress — confirm `status: publish`
4. Check `https://your-domain.com/feed/msn:article` — post appears after live publish
5. Syndication meta auto-enabled by mu-plugin on publish (not on draft-only sync)

### Test 3: Safety net check

1. Create a post WITHOUT a featured image
2. Try to publish
3. Confirm it gets forced back to "Draft" with an admin notice

---

## Phase 8: Clone to Remaining 19 Sites

Once everything works on the golden template:

### On Kinsta:

1. Use Kinsta's **"Clone Site"** feature (Sites → your site → Info → Clone)
2. Or use **Kinsta API** for bulk operations
3. Each clone gets:
   - New domain pointed
   - New bot user + App Password
   - New MSN Partner Hub feed registered
   - Fresh content (delete the test posts)

### Per-clone checklist:

- [ ] Domain pointed and HTTPS enabled
- [ ] Bot user created with Application Password
- [ ] App Password stored in SynthPress Dashboard project settings
- [ ] MSN Partner Hub feed registered
- [ ] Permalinks saved (flush rewrite rules)
- [ ] Test post → appears in feed
- [ ] Rank Math configured for the niche
- [ ] Site title / tagline set for the niche

---

## File Structure Summary (what the finished site looks like)

```
wp-content/
├── mu-plugins/
│   ├── auto-enable-msn-syndication.php    ← auto-enables MSN on every publish
│   ├── featured-image-requirement.php     ← blocks publish without featured image
│   └── restrict-author-login.php          ← blocks bot from wp-admin
├── plugins/
│   ├── msn-syndication-2/                 ← MSN RSS feed generator
│   ├── seo-by-rank-math/                  ← SEO (free from wp.org)
│   ├── auto-image-attributes.../          ← alt text filler (free from wp.org)
│   ├── disable-comments/                  ← spam prevention (free from wp.org)
│   └── user-role-editor/                  ← capability control (free from wp.org)
└── themes/
    ├── twentytwentyfive/                  ← active theme
    └── twentytwentyfour/                  ← fallback theme
```

---

## Quick Reference: Important URLs

| What | URL |
|---|---|
| Site frontend | `https://your-domain.com/` |
| WP Admin | `https://your-domain.com/wp-admin/` |
| REST API (posts) | `https://your-domain.com/wp-json/wp/v2/posts` |
| MSN Article Feed | `https://your-domain.com/feed/msn:article` |
| MSN Gallery Feed | `https://your-domain.com/feed/msn:gallery` |
| Syndication settings | `https://your-domain.com/wp-admin/options-general.php?page=syndication_tool` |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| 404 on `/feed/msn:article` | Re-save permalinks (Settings → Permalinks → Save) |
| REST API gets 401 | Check bot user Application Password — regenerate if needed |
| Images not being re-hosted | SynthPress Dashboard should upload images via REST API before creating the post — ensure images are uploaded to `/wp-json/wp/v2/media` first |
| Post stuck in draft | Missing featured image — set one and re-publish |
| MSN rejects feed | Check the feed XML manually; ensure AI disclosure is present and images have alt text |
| Feed shows 0 items | Posts need `syndication_tool_enabled = true` — check the mu-plugin is active |
