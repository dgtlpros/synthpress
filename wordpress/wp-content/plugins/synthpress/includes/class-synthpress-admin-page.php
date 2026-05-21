<?php
/**
 * Settings → SynthPress admin page.
 *
 * Renders four sections:
 *   1. Header + short intro.
 *   2. Readiness checklist (drives the user toward a green page).
 *   3. Bot user + Application Password cards (deep-links into WP
 *      Admin — no creation/persistence happens here).
 *   4. Connection package: read-only JSON textarea + Copy button
 *      the admin pastes into the SynthPress dashboard.
 *
 * @package SynthPress
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Synthpress_Admin_Page {

    /**
     * Hook suffix returned by `add_options_page`. Used to scope asset
     * loading so the plugin doesn't bloat unrelated admin screens.
     *
     * @var string
     */
    private $hook_suffix = '';

    /**
     * Register the Settings submenu entry. Capability is
     * `manage_options` — only site admins (or super admins on
     * multisite) should be installing a publishing integration.
     */
    public function register_menu() {
        $this->hook_suffix = (string) add_options_page(
            __('SynthPress', 'synthpress'),
            __('SynthPress', 'synthpress'),
            'manage_options',
            SYNTHPRESS_ADMIN_SLUG,
            [$this, 'render']
        );
    }

    /**
     * Enqueue plugin CSS + JS only on our settings screen. Other
     * admin pages get nothing.
     *
     * @param string $hook Current admin hook suffix.
     */
    public function enqueue_assets($hook) {
        if ($hook !== $this->hook_suffix || $this->hook_suffix === '') {
            return;
        }
        wp_enqueue_style(
            SYNTHPRESS_ADMIN_SLUG,
            SYNTHPRESS_PLUGIN_URL . 'assets/admin.css',
            [],
            SYNTHPRESS_VERSION
        );
        wp_enqueue_script(
            SYNTHPRESS_ADMIN_SLUG,
            SYNTHPRESS_PLUGIN_URL . 'assets/admin.js',
            [],
            SYNTHPRESS_VERSION,
            true
        );
        wp_set_script_translations(SYNTHPRESS_ADMIN_SLUG, 'synthpress');
    }

    /**
     * Render the admin page. Capability is re-checked here — even
     * though `add_options_page` enforces it, defense-in-depth is the
     * WordPress.org review reviewer's first habit.
     */
    public function render() {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to view this page.', 'synthpress'));
        }

        $readiness        = new Synthpress_Readiness();
        $checks           = $readiness->run_all();
        $bot              = $readiness->bot_user_snapshot();
        $connection_json  = wp_json_encode(
            $this->build_connection_package($checks, $bot),
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
        );
        // wp_json_encode can return false on rare encoding errors —
        // fall back to an explanatory string so the textarea is never
        // empty without context.
        if (!is_string($connection_json)) {
            $connection_json = '{ "error": "Could not encode connection package." }';
        }

        ?>
        <div class="wrap synthpress-wrap">
            <h1><?php esc_html_e('SynthPress Connector', 'synthpress'); ?></h1>
            <p class="synthpress-intro">
                <?php esc_html_e('This plugin prepares your WordPress site for SynthPress publishing. SynthPress uses the standard WordPress REST API and Application Passwords — nothing custom, nothing remote.', 'synthpress'); ?>
            </p>

            <?php $this->render_readiness_section($checks); ?>
            <?php $this->render_bot_user_section($bot); ?>
            <?php $this->render_application_password_section($bot); ?>
            <?php $this->render_connection_package_section($connection_json); ?>
        </div>
        <?php
    }

    // ─── sections ───────────────────────────────────────────────────────

    private function render_readiness_section(array $checks) {
        ?>
        <section class="synthpress-card" aria-labelledby="synthpress-readiness-heading">
            <h2 id="synthpress-readiness-heading"><?php esc_html_e('Readiness checklist', 'synthpress'); ?></h2>
            <p class="synthpress-card-help">
                <?php esc_html_e('Each row reflects the state of this WordPress install. A failed row will not block you from saving credentials in SynthPress, but it tells you what to fix first.', 'synthpress'); ?>
            </p>
            <ul class="synthpress-checks">
                <?php foreach ($checks as $check) : ?>
                    <li class="synthpress-check synthpress-check--<?php echo esc_attr($check['status']); ?>">
                        <span class="synthpress-check-status" aria-hidden="true"><?php echo esc_html($this->status_glyph($check['status'])); ?></span>
                        <span class="synthpress-check-status-label screen-reader-text"><?php echo esc_html($this->status_label($check['status'])); ?></span>
                        <span class="synthpress-check-label"><?php echo esc_html($check['label']); ?></span>
                        <span class="synthpress-check-message"><?php echo esc_html($check['message']); ?></span>
                    </li>
                <?php endforeach; ?>
            </ul>
        </section>
        <?php
    }

    private function render_bot_user_section($bot) {
        ?>
        <section class="synthpress-card" aria-labelledby="synthpress-bot-heading">
            <h2 id="synthpress-bot-heading"><?php esc_html_e('Bot user', 'synthpress'); ?></h2>
            <p class="synthpress-card-help">
                <?php
                printf(
                    /* translators: %s: bot user login name. */
                    esc_html__('SynthPress connects as any WordPress user with the right capabilities. We recommend a dedicated Editor user named %s so its activity is easy to audit.', 'synthpress'),
                    '<code>' . esc_html(Synthpress_Readiness::BOT_LOGIN) . '</code>'
                );
                ?>
            </p>
            <?php if ($bot !== null) : ?>
                <table class="widefat striped synthpress-table" role="presentation">
                    <tbody>
                        <tr>
                            <th scope="row"><?php esc_html_e('Display name', 'synthpress'); ?></th>
                            <td><?php echo esc_html($bot['display_name']); ?></td>
                        </tr>
                        <tr>
                            <th scope="row"><?php esc_html_e('User ID', 'synthpress'); ?></th>
                            <td><?php echo esc_html((string) $bot['id']); ?></td>
                        </tr>
                        <tr>
                            <th scope="row"><?php esc_html_e('Roles', 'synthpress'); ?></th>
                            <td><?php echo esc_html(implode(', ', $bot['roles'])); ?></td>
                        </tr>
                        <tr>
                            <th scope="row"><?php esc_html_e('Profile', 'synthpress'); ?></th>
                            <td>
                                <?php if (!empty($bot['edit_url'])) : ?>
                                    <a href="<?php echo esc_url($bot['edit_url']); ?>">
                                        <?php esc_html_e('Open profile', 'synthpress'); ?>
                                    </a>
                                <?php else : ?>
                                    <em><?php esc_html_e('Profile link unavailable for the current viewer.', 'synthpress'); ?></em>
                                <?php endif; ?>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <p class="synthpress-warning">
                    <?php esc_html_e('Use the Editor role for the bot when possible. Administrator works too, but a smaller permission set is safer if the Application Password leaks.', 'synthpress'); ?>
                </p>
            <?php else : ?>
                <p>
                    <?php
                    printf(
                        /* translators: %s: bot user login name. */
                        esc_html__('No user with the login %s exists yet. Create one in Users → Add New (role: Editor), then refresh this page.', 'synthpress'),
                        '<code>' . esc_html(Synthpress_Readiness::BOT_LOGIN) . '</code>'
                    );
                    ?>
                </p>
                <p>
                    <a class="button button-secondary" href="<?php echo esc_url(admin_url('user-new.php')); ?>">
                        <?php esc_html_e('Go to Users → Add New', 'synthpress'); ?>
                    </a>
                </p>
            <?php endif; ?>
        </section>
        <?php
    }

    private function render_application_password_section($bot) {
        ?>
        <section class="synthpress-card" aria-labelledby="synthpress-app-password-heading">
            <h2 id="synthpress-app-password-heading"><?php esc_html_e('Application Password', 'synthpress'); ?></h2>
            <p class="synthpress-card-help">
                <?php esc_html_e('SynthPress authenticates with a per-application password generated by WordPress core. It is shown by WordPress one time only — copy it immediately into SynthPress.', 'synthpress'); ?>
            </p>
            <ol class="synthpress-steps">
                <li>
                    <?php
                    if ($bot !== null && !empty($bot['edit_url'])) {
                        printf(
                            /* translators: 1: opening anchor, 2: closing anchor, 3: bot login. */
                            esc_html__('Open the %1$s%3$s profile%2$s.', 'synthpress'),
                            '<a href="' . esc_url($bot['edit_url']) . '">',
                            '</a>',
                            esc_html(Synthpress_Readiness::BOT_LOGIN)
                        );
                    } else {
                        printf(
                            /* translators: 1: opening anchor, 2: closing anchor. */
                            esc_html__('Create the bot user first under %1$sUsers → Add New%2$s, then come back.', 'synthpress'),
                            '<a href="' . esc_url(admin_url('user-new.php')) . '">',
                            '</a>'
                        );
                    }
                    ?>
                </li>
                <li>
                    <?php
                    printf(
                        /* translators: %s: literal application name suggestion. */
                        esc_html__('Scroll to “Application Passwords”, name it %s, and click Add New Application Password.', 'synthpress'),
                        '<code>SynthPress</code>'
                    );
                    ?>
                </li>
                <li><?php esc_html_e('Copy the 24-character password WordPress reveals. WordPress will not show it again.', 'synthpress'); ?></li>
                <li><?php esc_html_e('Paste the password into the SynthPress Connections page, then click Test connection.', 'synthpress'); ?></li>
            </ol>
            <p class="synthpress-warning">
                <strong><?php esc_html_e('This plugin never stores, transmits, or displays your Application Password.', 'synthpress'); ?></strong>
                <?php esc_html_e('It exists only inside the SynthPress dashboard\'s server-side credential store and inside WordPress core\'s hashed Application Passwords table.', 'synthpress'); ?>
            </p>
        </section>
        <?php
    }

    private function render_connection_package_section($connection_json) {
        ?>
        <section class="synthpress-card" aria-labelledby="synthpress-package-heading">
            <h2 id="synthpress-package-heading"><?php esc_html_e('Connection package', 'synthpress'); ?></h2>
            <p class="synthpress-card-help">
                <?php esc_html_e('Copy this JSON into the SynthPress Connections page to pre-fill the WordPress URL and other safe site metadata. The package never contains your Application Password or any other secret.', 'synthpress'); ?>
            </p>
            <label class="screen-reader-text" for="synthpress-connection-package">
                <?php esc_html_e('SynthPress connection package JSON', 'synthpress'); ?>
            </label>
            <textarea
                id="synthpress-connection-package"
                class="synthpress-package-textarea"
                rows="14"
                readonly
                spellcheck="false"
                aria-describedby="synthpress-package-help"
            ><?php echo esc_textarea($connection_json); ?></textarea>
            <p id="synthpress-package-help" class="synthpress-card-help">
                <?php esc_html_e('Click inside the textarea to select all, or use the button below.', 'synthpress'); ?>
            </p>
            <p>
                <button
                    type="button"
                    class="button button-primary"
                    id="synthpress-copy-package"
                    data-copy-target="synthpress-connection-package"
                    data-copy-label="<?php echo esc_attr__('Copy connection package', 'synthpress'); ?>"
                    data-copied-label="<?php echo esc_attr__('Copied!', 'synthpress'); ?>"
                >
                    <?php esc_html_e('Copy connection package', 'synthpress'); ?>
                </button>
                <span
                    id="synthpress-copy-feedback"
                    class="synthpress-copy-feedback"
                    role="status"
                    aria-live="polite"
                ></span>
            </p>
        </section>
        <?php
    }

    // ─── helpers ────────────────────────────────────────────────────────

    /**
     * Build the JSON payload an admin copies into SynthPress.
     *
     * Whitelisted fields only — anything user-supplied (display name,
     * site name, REST URL) is JSON-encoded so escape concerns are
     * confined to the textarea render path.
     *
     * @param array<int,array<string,string>> $checks
     * @param array<string,mixed>|null        $bot
     *
     * @return array<string,mixed>
     */
    private function build_connection_package(array $checks, $bot) {
        $package = [
            'kind'          => 'synthpress.wordpressConnection',
            'schemaVersion' => 1,
            'exportedAt'    => gmdate('c'),
            'site'          => [
                'name'             => (string) get_bloginfo('name'),
                'url'              => (string) home_url(),
                'adminUrl'         => (string) admin_url(),
                'restUrl'          => (string) rest_url(),
                'wordpressVersion' => (string) get_bloginfo('version'),
            ],
            'plugin' => [
                'installed' => true,
                'version'   => SYNTHPRESS_VERSION,
            ],
            'recommendedUser' => [
                'login'  => Synthpress_Readiness::BOT_LOGIN,
                'exists' => $bot !== null,
                'roles'  => $bot !== null ? $bot['roles'] : [],
            ],
            'readiness' => array_map(
                static function ($check) {
                    return [
                        'key'     => (string) $check['key'],
                        'label'   => (string) $check['label'],
                        'status'  => (string) $check['status'],
                        'message' => (string) $check['message'],
                    ];
                },
                $checks
            ),
        ];
        return $package;
    }

    private function status_glyph($status) {
        switch ($status) {
            case Synthpress_Readiness::STATUS_PASS:
                return '✓';
            case Synthpress_Readiness::STATUS_WARNING:
                return '!';
            case Synthpress_Readiness::STATUS_FAIL:
                return '✗';
        }
        return '·';
    }

    private function status_label($status) {
        switch ($status) {
            case Synthpress_Readiness::STATUS_PASS:
                return __('Pass', 'synthpress');
            case Synthpress_Readiness::STATUS_WARNING:
                return __('Warning', 'synthpress');
            case Synthpress_Readiness::STATUS_FAIL:
                return __('Fail', 'synthpress');
        }
        return '';
    }
}
