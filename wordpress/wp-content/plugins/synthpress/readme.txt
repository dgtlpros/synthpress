=== SynthPress ===
Contributors: synthpress
Tags: rest-api, application-passwords, publishing, ai, integration
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 8.0
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Helps prepare WordPress for SynthPress, an external dashboard that drafts and publishes posts through the standard WP REST API.

== Description ==

**SynthPress** is an external dashboard that creates and updates WordPress posts through the built-in REST API using a WordPress Application Password. This plugin lives **inside WordPress** and exists to make first-time setup quick and auditable.

What the plugin does:

* Adds **Settings → SynthPress** in the WordPress admin (visible only to users with `manage_options`).
* Runs a **readiness checklist** for REST availability, Application Password support, HTTPS, permalinks, and the capabilities SynthPress needs (`edit_posts`, `publish_posts`, `upload_files`, `manage_categories`).
* Detects the recommended `synthpress-bot` user and links to its profile, or guides you through creating one.
* Tells you exactly how to generate a WordPress Application Password named "SynthPress" — without ever touching or storing the password itself.
* Exports a small JSON **connection package** (site URL, REST URL, admin URL, WordPress version, recommended user) that you copy and paste into the SynthPress dashboard's Connections tab.
* Registers a single read-only REST endpoint, `GET /wp-json/synthpress/v1/readiness`, that returns the same payload for future automated import flows. The endpoint is authenticated — it requires `edit_posts` or `manage_options`.

What the plugin deliberately does **not** do:

* It does **not** generate AI content inside WordPress. Content generation happens in the SynthPress dashboard.
* It does **not** send any data to SynthPress or any other remote server automatically. The plugin makes zero outbound HTTP requests.
* It does **not** store, transmit, or display your Application Password.
* It does **not** replace WordPress Application Passwords with a custom auth scheme.
* It does **not** add tracking, analytics, telemetry, or "phone home" calls.
* It does **not** create users or Application Passwords on your behalf — every step is performed by the admin in the WordPress UI.

== External services ==

This plugin does not contact any external services. All operations run locally on your WordPress install. The connection package is rendered as plain JSON inside the admin page — you copy and paste it manually.

== Installation ==

1. Upload the `synthpress` folder to `/wp-content/plugins/`, or install through the Plugins screen in WordPress.
2. Activate the plugin from the Plugins screen.
3. Open **Settings → SynthPress** in the WordPress admin.
4. Work through the readiness checklist; fix any failing checks.
5. Create a dedicated `synthpress-bot` user (role: Editor) if you don't already have one.
6. Generate an Application Password named `SynthPress` for the bot user.
7. Click **Copy connection package**, paste it into the SynthPress dashboard's Connections tab, then paste the Application Password separately and click **Test connection**.

== Frequently Asked Questions ==

= Does this plugin send data anywhere? =

No. The plugin makes no outbound HTTP requests and stores no options. The JSON connection package is rendered locally in your WordPress admin; you copy it manually into the SynthPress dashboard.

= Where is my Application Password stored? =

Only inside WordPress core's hashed Application Passwords table and inside the SynthPress dashboard's server-side credential store. This plugin never sees, displays, or transmits it.

= Does this plugin require the SynthPress dashboard? =

No. The plugin works as a standalone WordPress readiness checker even if you never sign up for SynthPress. If you do, the connection package speeds up the dashboard's Connections setup.

= Can I publish posts without this plugin? =

Yes. SynthPress uses the stock WordPress REST API + Application Passwords. This plugin only improves the connection workflow — it is optional.

= What WordPress role should the bot user have? =

Editor is recommended. Administrator works but is over-privileged for the publishing flow; if the Application Password ever leaks, the smaller capability set limits the damage.

= Does this plugin work on multisite? =

Yes — it activates per-site and respects the same Application Passwords network policy filters core uses.

== Changelog ==

= 0.1.0 =
* Initial release.
* Settings → SynthPress admin page (capability: `manage_options`).
* Readiness checklist (REST, Application Passwords, HTTPS, permalinks, capability gates, bot user detection).
* Connection package export (read-only JSON + Copy to clipboard).
* Authenticated `GET /wp-json/synthpress/v1/readiness` REST endpoint (`edit_posts` or `manage_options`).
* No remote calls, no options stored, no secrets handled by the plugin.

== Upgrade Notice ==

= 0.1.0 =
First release. Optional but recommended companion plugin for sites that connect to the SynthPress dashboard.
