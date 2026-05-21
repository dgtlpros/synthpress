<?php
/**
 * `GET /wp-json/synthpress/v1/readiness` — read-only authenticated
 * endpoint that returns the same shape the admin page renders.
 *
 * The endpoint exists so a future version of the SynthPress
 * dashboard can pre-flight a connection without scraping HTML. The
 * dashboard does NOT call it today.
 *
 * Security posture:
 *   * Requires the caller to authenticate (Application Password or
 *     cookie) AND hold `edit_posts` OR `manage_options`. Anonymous
 *     callers get 401; under-privileged callers get 403.
 *   * No write methods are registered.
 *   * No secrets are returned. Capability/role info is intentionally
 *     limited to what `users/me?context=edit` already exposes.
 *
 * @package SynthPress
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Synthpress_Rest_Controller {

    // `NAMESPACE` is a reserved word in PHP — prefix the class constant
    // so the parser never has to disambiguate it.
    public const REST_NAMESPACE = 'synthpress/v1';
    public const REST_ROUTE     = '/readiness';

    public function register_routes() {
        register_rest_route(
            self::REST_NAMESPACE,
            self::REST_ROUTE,
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'handle_readiness'],
                'permission_callback' => [$this, 'permission_check'],
                'args'                => [],
            ]
        );
    }

    /**
     * Gate the endpoint behind a real WordPress capability. Returning
     * `false` (vs `WP_Error`) lets core respond 401 / 403 with the
     * stock message and avoids leaking why the call was rejected.
     *
     * @return bool
     */
    public function permission_check() {
        return current_user_can('edit_posts') || current_user_can('manage_options');
    }

    /**
     * Build the readiness payload. Same fields the admin page uses,
     * plus a `currentUser` block (id / display name / slug / roles)
     * mirroring what `wp/v2/users/me?context=edit` already returns —
     * so the SynthPress app can confirm "which WP user am I talking
     * to" without a separate round-trip.
     *
     * @return WP_REST_Response
     */
    public function handle_readiness() {
        $readiness   = new Synthpress_Readiness();
        $checks      = $readiness->run_all();
        $bot         = $readiness->bot_user_snapshot();
        $current     = wp_get_current_user();
        $current_out = [
            'id'    => (int) $current->ID,
            'name'  => (string) $current->display_name,
            'slug'  => (string) $current->user_nicename,
            'roles' => array_values(array_map('strval', (array) $current->roles)),
        ];

        $payload = [
            'plugin' => [
                'version' => SYNTHPRESS_VERSION,
            ],
            'site' => [
                'name'             => (string) get_bloginfo('name'),
                'url'              => (string) home_url(),
                'restUrl'          => (string) rest_url(),
                'wordpressVersion' => (string) get_bloginfo('version'),
            ],
            'currentUser'     => $current_out,
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

        return rest_ensure_response($payload);
    }
}
