<?php
/**
 * Plugin Name:       SynthPress
 * Plugin URI:        https://github.com/synthpress/synthpress
 * Description:       Connects WordPress sites to SynthPress for AI-assisted draft publishing. Runs readiness checks, helps prepare a bot user + Application Password, and exports a connection package you paste into SynthPress. Uses the standard WordPress REST API and Application Passwords — nothing else.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      8.0
 * Author:            SynthPress
 * Author URI:        https://synthpress.app
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       synthpress
 *
 * @package SynthPress
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SYNTHPRESS_VERSION', '0.1.0');
define('SYNTHPRESS_PLUGIN_FILE', __FILE__);
define('SYNTHPRESS_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('SYNTHPRESS_PLUGIN_URL', plugin_dir_url(__FILE__));
// Slug used both for the Settings page hook suffix and the JS/CSS handles.
define('SYNTHPRESS_ADMIN_SLUG', 'synthpress');

require_once SYNTHPRESS_PLUGIN_DIR . 'includes/class-synthpress-readiness.php';
require_once SYNTHPRESS_PLUGIN_DIR . 'includes/class-synthpress-admin-page.php';
require_once SYNTHPRESS_PLUGIN_DIR . 'includes/class-synthpress-rest-controller.php';
require_once SYNTHPRESS_PLUGIN_DIR . 'includes/class-synthpress-plugin.php';

// Bootstrap once WordPress has finished loading plugins so hooks like
// `admin_menu` and `rest_api_init` fire in the right order.
add_action('plugins_loaded', ['Synthpress_Plugin', 'instance']);
