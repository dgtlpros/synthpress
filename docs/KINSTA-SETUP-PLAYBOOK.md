# Kinsta MSN Autopilot Site — Setup Playbook

> **Purpose**: This document is the complete setup guide for building one "golden template" WordPress site on Kinsta that connects Confleko (AI publishing) to MSN Partner Hub (syndication). Once this site is working end-to-end, it gets cloned 19 times.
>
> **Who this is for**: An AI assistant in a new Cursor workspace (the DevKinsta local copy of the Kinsta site). Give it this file as context so it knows what to build.

---

## The Goal

```
Confleko (AI SaaS) → WordPress on Kinsta → MSN Partner Hub
                                          → Public visitors via WP theme
```

- **20 posts/day** across the network (starts with 1 site)
- Standard WordPress frontend (NOT headless — no Next.js)
- MSN auto-publishes from our RSS feed
- Confleko handles AI content generation and pushes via REST API
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
   - Admin username: your personal admin (NOT the one Confleko will use)
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

### Required plugins (6 total)

| Plugin | Source | How to install |
|---|---|---|
| **confleko-2** | Copy from pet-mojo reference site | Upload ZIP or copy folder |
| **msn-syndication-2** | Copy from pet-mojo reference site | Upload ZIP or copy folder |
| **Rank Math SEO** | WordPress.org (free) | Install from WP Admin → Plugins → Add New |
| **Auto Image Attributes From Filename** | WordPress.org (free) | Install from WP Admin → Plugins → Add New |
| **Disable Comments** | WordPress.org (free) | Install from WP Admin → Plugins → Add New |
| **User Role Editor** | WordPress.org (free) | Install from WP Admin → Plugins → Add New |

### Plugin source files (from the reference site)

The two custom plugins live in the reference repo at:
```
/path/to/pet-mojo/app/public/wp-content/plugins/confleko-2/
/path/to/pet-mojo/app/public/wp-content/plugins/msn-syndication-2/
```

Copy these entire folders into the new site's `wp-content/plugins/` directory.

### After installing — activate all 6 plugins

---

## Phase 3: Theme Setup

### 3.1 Pick a lightweight theme

Recommended options (all free, fast, MSN-compatible):
- **GeneratePress** — lightweight, fast, good for content sites
- **Flavor** — minimal, block-based
- **Flavor** — clean starter theme
- **Twenty Twenty-Five** (WordPress default) — zero dependencies

For MSN compatibility, the theme just needs to output clean HTML with proper heading hierarchy. Any of these work.

### 3.2 Create a child theme

Create a child theme with the critical customizations ported from the reference site. The child theme needs:

```
wp-content/themes/{parent-theme}-child/
├── style.css
├── functions.php
└── inc/
    ├── featured-image-requirement.php
    ├── restrict-author-login.php
    └── user-profile.php (optional — for E-E-A-T author schema)
```

### 3.3 Child theme: `style.css`

```css
/*
Theme Name: {Parent Theme} Child
Template: {parent-theme-slug}
Description: Child theme for MSN autopilot site
Version: 1.0
*/
```

### 3.4 Child theme: `functions.php`

```php
<?php
if (!defined('ABSPATH')) exit;

// Include critical customizations
include_once('inc/featured-image-requirement.php');
include_once('inc/restrict-author-login.php');

// Optional: author schema fields for E-E-A-T
// include_once('inc/user-profile.php');
```

### 3.5 Child theme: `inc/featured-image-requirement.php`

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

### 3.6 Child theme: `inc/restrict-author-login.php`

Prevents the Confleko bot user (Author role) from accessing wp-admin unless explicitly allowed.

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

### 4.1 Create the Confleko bot user

1. **Users → Add New**
   - Username: `confleko-bot` (or similar)
   - Email: a dedicated email for this
   - Role: **Editor** (needs `edit_posts`, `publish_posts`, `upload_files`, `edit_others_posts`)
   - Password: anything (won't use password login)

2. **Why Editor and not Author?** Confleko needs to be able to set post meta fields (like `syndication_tool_enabled`) which requires `edit_others_posts` or a custom capability. Editor covers this.

### 4.2 Connect Confleko

1. Log in as the `confleko-bot` user (or your admin)
2. Go to **Settings → Confleko**
3. Click **"Connect your website to Confleko"**
4. Copy the returned credentials (username, app password, domain)
5. Paste into your Confleko dashboard under this site's connection

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
3. This ensures any image Confleko uploads via the REST API gets proper alt text

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

```
1. You create/approve an article in Confleko's dashboard
2. Confleko POSTs to: https://your-domain.com/wp-json/wp/v2/posts
   - Body: { title, content, status: "publish", featured_media: <id>, meta: {...} }
   - Auth: HTTP Basic (confleko-bot : app-password)
3. WordPress saves the post
4. confleko-2 plugin fires on save_post:
   - Downloads all external images → Media Library
   - Rewrites <img src="..."> to local URLs
   - Strips srcset/sizes
   - Fills missing alt/title attributes
5. featured-image-requirement.php checks for thumbnail
   - No thumbnail → reverts to draft (safety net)
6. Kinsta's cache auto-purges → post is live on the public site
7. MSN's crawler hits /feed/msn:article (every few minutes)
   - Picks up the new post (if syndication_tool_enabled = true)
   - Validates images, metadata, AI disclosure
   - Auto-publishes to MSN.com / Edge / Bing
```

### 5.2 Making Confleko set the MSN meta fields automatically

For TRUE autopilot, Confleko needs to set these meta fields when creating the post:

```json
{
  "title": "Your Article Title",
  "content": "<p>Article body...</p>",
  "status": "publish",
  "meta": {
    "syndication_tool_enabled": true,
    "syndication_tool_schema_types": ["article"],
    "syndication_tool_ai_disclosure_enable": true,
    "syndication_tool_backlink_enable": true
  }
}
```

**Ask Confleko support**: "Can I include custom post meta fields in the publish payload? Specifically, I need `syndication_tool_enabled`, `syndication_tool_schema_types`, `syndication_tool_ai_disclosure_enable`, and `syndication_tool_backlink_enable` to be set automatically when you publish."

If Confleko can't set meta directly, you have two fallback options:
1. Write a small `mu-plugin` that auto-enables syndication on every new `publish` post
2. Use a WordPress hook to default those meta fields

**Fallback mu-plugin** (put in `wp-content/mu-plugins/auto-enable-msn-syndication.php`):

```php
<?php
/**
 * Auto-enable MSN syndication for all newly published posts.
 * Drop this in wp-content/mu-plugins/
 */
add_action('transition_post_status', function($new_status, $old_status, $post) {
    if ($new_status === 'publish' && $old_status !== 'publish' && $post->post_type === 'post') {
        update_post_meta($post->ID, 'syndication_tool_enabled', 1);
        update_post_meta($post->ID, 'syndication_tool_schema_types', ['article']);
        update_post_meta($post->ID, 'syndication_tool_ai_disclosure_enable', 1);
        update_post_meta($post->ID, 'syndication_tool_backlink_enable', 1);
    }
}, 10, 3);
```

This means: every post that transitions to "publish" for the first time automatically gets MSN syndication enabled. Zero manual clicks needed.

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

### Test 2: Confleko-published post

1. In Confleko's dashboard, generate an article for this site
2. Publish it
3. Check WP Admin → Posts — confirm it arrived as "Published"
4. Check Media Library — confirm external images were re-hosted locally
5. Check `https://your-domain.com/feed/msn:article` — confirm it's in the feed
6. If using the mu-plugin, syndication should be auto-enabled

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
   - New Confleko bot user + App Password
   - New MSN Partner Hub feed registered
   - Fresh content (delete the test posts)

### Per-clone checklist:

- [ ] Domain pointed and HTTPS enabled
- [ ] Confleko connected (new App Password)
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
│   └── auto-enable-msn-syndication.php    ← auto-enables MSN on every publish
├── plugins/
│   ├── confleko-2/                        ← AI image rehosting + auth
│   ├── msn-syndication-2/                 ← MSN RSS feed generator
│   ├── seo-by-rank-math/                  ← SEO (free from wp.org)
│   ├── auto-image-attributes.../          ← alt text filler (free from wp.org)
│   ├── disable-comments/                  ← spam prevention (free from wp.org)
│   └── user-role-editor/                  ← capability control (free from wp.org)
└── themes/
    ├── {parent-theme}/
    └── {parent-theme}-child/
        ├── style.css
        ├── functions.php
        └── inc/
            ├── featured-image-requirement.php
            └── restrict-author-login.php
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
| Confleko settings | `https://your-domain.com/wp-admin/options-general.php?page=confleko-settings` |
| Syndication settings | `https://your-domain.com/wp-admin/options-general.php?page=syndication_tool` |
| Import logs | `https://your-domain.com/wp-admin/options-general.php?page=confleko-import-logs` |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| 404 on `/feed/msn:article` | Re-save permalinks (Settings → Permalinks → Save) |
| Confleko gets 401 | Re-run the "Connect" flow in Settings → Confleko |
| Images not being re-hosted | Check that `confleko-2` is activated and the import log table exists |
| Post stuck in draft | Missing featured image — set one and re-publish |
| MSN rejects feed | Check the feed XML manually; ensure AI disclosure is present and images have alt text |
| Feed shows 0 items | Posts need `syndication_tool_enabled = true` — check the mu-plugin is active |
