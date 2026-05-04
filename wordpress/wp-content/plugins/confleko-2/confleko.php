<?php

/**
 * Plugin Name: Confleko
 * Description: Your AI Content Assistant. This plugin will help you connect your wordpress page with Confleko. It will add images added through Confleko to your Media Library.
 * Version: 1.64
 * Author: Confleko
 * Author URI: https://confleko.com
 */

// Security check to ensure PHP script is accessed via WordPress.
if (!defined('ABSPATH')) {
    exit;
}

// Include necessary files.
require_once plugin_dir_path(__FILE__) . 'includes/auth-functions.php';
require_once plugin_dir_path(__FILE__) . 'includes/api-functions.php';
require_once plugin_dir_path(__FILE__) . 'includes/image-functions.php';
//require_once plugin_dir_path(__FILE__) . 'includes/discover-functions.php';
require_once plugin_dir_path(__FILE__) . 'includes/thumbnails-recreate.php';
require_once plugin_dir_path(__FILE__) . 'includes/seo-functions.php';

// Add new includes
require_once plugin_dir_path(__FILE__) . 'includes/database-functions.php';
require_once plugin_dir_path(__FILE__) . 'includes/import-log-functions.php';

// Register activation hook
register_activation_hook(__FILE__, 'confleko_create_import_table');
register_activation_hook(__FILE__, 'confleko_check_db_upgrade');

// Also check for upgrades on plugin load for existing installations
add_action('plugins_loaded', 'confleko_check_db_upgrade');
