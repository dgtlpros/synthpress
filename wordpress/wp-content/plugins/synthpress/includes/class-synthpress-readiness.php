<?php
/**
 * Pure readiness checks for the SynthPress connector.
 *
 * Every check returns an associative array of the form:
 *
 *     [
 *         'key'     => 'rest_api_available',
 *         'label'   => 'WordPress REST API reachable',
 *         'status'  => 'pass' | 'warning' | 'fail',
 *         'message' => 'Free-form copy explaining the result.',
 *     ]
 *
 * No I/O outside of {@see get_option()}, {@see get_user_by()}, and
 * the capability helpers — and no remote requests at all. The same
 * payload feeds the admin page and the read-only REST endpoint.
 *
 * @package SynthPress
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Synthpress_Readiness {

    public const BOT_LOGIN = 'synthpress-bot';

    public const STATUS_PASS    = 'pass';
    public const STATUS_WARNING = 'warning';
    public const STATUS_FAIL    = 'fail';

    /**
     * Run every check and return them in the order they should
     * render. A failed check never short-circuits — the admin sees
     * the full picture in one pass.
     *
     * @return array<int, array{key:string,label:string,status:string,message:string}>
     */
    public function run_all() {
        return [
            $this->check_rest_api(),
            $this->check_application_passwords(),
            $this->check_https(),
            $this->check_pretty_permalinks(),
            $this->check_can_edit_posts(),
            $this->check_can_publish_posts(),
            $this->check_can_upload_files(),
            $this->check_can_manage_categories(),
            $this->check_bot_user(),
        ];
    }

    /**
     * Quick snapshot of the `synthpress-bot` user (or null). Used by
     * the admin page to render the "Bot user" card and by the REST
     * controller for the recommended-user block.
     *
     * Only safe-to-expose fields are returned — display name, login,
     * roles, ID, profile edit URL. No email, no meta, no capabilities
     * map.
     *
     * @return array{id:int,login:string,display_name:string,roles:array<int,string>,edit_url:string}|null
     */
    public function bot_user_snapshot() {
        $user = get_user_by('login', self::BOT_LOGIN);
        if (!$user instanceof WP_User) {
            return null;
        }
        return [
            'id'           => (int) $user->ID,
            'login'        => (string) $user->user_login,
            'display_name' => (string) $user->display_name,
            'roles'        => array_values(array_map('strval', (array) $user->roles)),
            'edit_url'     => get_edit_user_link($user->ID),
        ];
    }

    // ─── individual checks ──────────────────────────────────────────────

    private function check_rest_api() {
        $rest_url = rest_url();
        if (is_string($rest_url) && str_contains($rest_url, '/wp-json/')) {
            return $this->ok('rest_api_available', __('WordPress REST API reachable', 'synthpress'), sprintf(
                /* translators: %s: REST API base URL. */
                __('Base URL: %s', 'synthpress'),
                $rest_url
            ));
        }
        return $this->fail('rest_api_available', __('WordPress REST API reachable', 'synthpress'), __(
            'The REST API base URL could not be resolved. SynthPress publishes via REST, so this must be available.',
            'synthpress'
        ));
    }

    private function check_application_passwords() {
        // `wp_is_application_passwords_available()` was added in WP 5.6
        // and accounts for the network policy filter
        // (`wp_is_application_passwords_available_for_user`). It's the
        // canonical way to detect availability.
        if (!function_exists('wp_is_application_passwords_available')) {
            return $this->fail(
                'application_passwords_available',
                __('Application Passwords supported', 'synthpress'),
                __('Application Passwords require WordPress 5.6 or newer. Please upgrade WordPress.', 'synthpress')
            );
        }
        if (wp_is_application_passwords_available()) {
            return $this->ok(
                'application_passwords_available',
                __('Application Passwords supported', 'synthpress'),
                __('Application Passwords are enabled on this site.', 'synthpress')
            );
        }
        return $this->fail(
            'application_passwords_available',
            __('Application Passwords supported', 'synthpress'),
            __('Application Passwords are disabled. Ask your host or a network admin to re-enable them — SynthPress cannot authenticate without them.', 'synthpress')
        );
    }

    private function check_https() {
        if (is_ssl() || str_starts_with((string) home_url(), 'https://')) {
            return $this->ok(
                'https_enabled',
                __('HTTPS enabled', 'synthpress'),
                __('Application Passwords travel as HTTP Basic auth, so HTTPS is required for safe use.', 'synthpress')
            );
        }
        return $this->fail(
            'https_enabled',
            __('HTTPS enabled', 'synthpress'),
            __('HTTPS is not detected. Connecting SynthPress without HTTPS would expose your Application Password on the wire.', 'synthpress')
        );
    }

    private function check_pretty_permalinks() {
        $structure = (string) get_option('permalink_structure');
        if ($structure !== '') {
            return $this->ok(
                'pretty_permalinks_enabled',
                __('Pretty permalinks enabled', 'synthpress'),
                __('REST routes work either way, but pretty permalinks make the published post URLs and the REST namespace easier to test by hand.', 'synthpress')
            );
        }
        return $this->warning(
            'pretty_permalinks_enabled',
            __('Pretty permalinks enabled', 'synthpress'),
            __('Default permalinks work, but switching to Post name in Settings → Permalinks is recommended for cleaner URLs.', 'synthpress')
        );
    }

    private function check_can_edit_posts() {
        return $this->capability_check(
            'current_user_can_edit_posts',
            __('You can edit posts (current user)', 'synthpress'),
            'edit_posts',
            __('SynthPress drafts and edits go through REST, which checks this capability.', 'synthpress')
        );
    }

    private function check_can_publish_posts() {
        return $this->capability_check(
            'current_user_can_publish_posts',
            __('You can publish posts (current user)', 'synthpress'),
            'publish_posts',
            __('Required for the manual “Publish live” action from the SynthPress article page. Autopilot draft-only does not need this.', 'synthpress')
        );
    }

    private function check_can_upload_files() {
        return $this->capability_check(
            'current_user_can_upload_files',
            __('You can upload media (current user)', 'synthpress'),
            'upload_files',
            __('Featured images and section images are uploaded to the WordPress Media Library via REST. Without this capability they will not attach.', 'synthpress')
        );
    }

    private function check_can_manage_categories() {
        return $this->capability_check(
            'current_user_can_manage_categories',
            __('You can create categories and tags (current user)', 'synthpress'),
            'manage_categories',
            __('Optional — SynthPress falls back to existing categories/tags when this capability is missing, but new categories or tags cannot be created from the dashboard.', 'synthpress'),
            self::STATUS_WARNING
        );
    }

    private function check_bot_user() {
        $snapshot = $this->bot_user_snapshot();
        if ($snapshot === null) {
            return $this->warning(
                'synthpress_bot_user_exists',
                /* translators: %s: bot user login name. */
                sprintf(__('User “%s” exists', 'synthpress'), self::BOT_LOGIN),
                /* translators: %s: bot user login name. */
                sprintf(__('No user with login “%s” found yet. You can connect SynthPress as any Editor — the dedicated bot is optional but recommended for auditability.', 'synthpress'), self::BOT_LOGIN)
            );
        }
        $roles = implode(', ', $snapshot['roles']);
        return $this->ok(
            'synthpress_bot_user_exists',
            /* translators: %s: bot user login name. */
            sprintf(__('User “%s” exists', 'synthpress'), self::BOT_LOGIN),
            /* translators: 1: display name, 2: comma-separated WordPress roles. */
            sprintf(__('Found %1$s (roles: %2$s).', 'synthpress'), $snapshot['display_name'], $roles)
        );
    }

    // ─── helpers ────────────────────────────────────────────────────────

    private function capability_check($key, $label, $cap, $message_when_failing, $failing_status = self::STATUS_FAIL) {
        if (current_user_can($cap)) {
            return $this->ok($key, $label, __('Capability present on the user viewing this page.', 'synthpress'));
        }
        return [
            'key'     => $key,
            'label'   => $label,
            'status'  => $failing_status,
            'message' => $message_when_failing,
        ];
    }

    private function ok($key, $label, $message) {
        return [
            'key'     => $key,
            'label'   => $label,
            'status'  => self::STATUS_PASS,
            'message' => $message,
        ];
    }

    private function warning($key, $label, $message) {
        return [
            'key'     => $key,
            'label'   => $label,
            'status'  => self::STATUS_WARNING,
            'message' => $message,
        ];
    }

    private function fail($key, $label, $message) {
        return [
            'key'     => $key,
            'label'   => $label,
            'status'  => self::STATUS_FAIL,
            'message' => $message,
        ];
    }
}
