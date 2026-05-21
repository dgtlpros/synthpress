<?php
/**
 * Top-level plugin orchestrator. Holds the singleton, wires the
 * admin page + REST controller, and loads the text domain.
 *
 * Deliberately small — there are no options to migrate, no cron, no
 * remote calls, so this class only exists to give the sub-objects a
 * single place to attach their hooks.
 *
 * @package SynthPress
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Synthpress_Plugin {

    /**
     * @var Synthpress_Plugin|null
     */
    private static $instance = null;

    /**
     * @var Synthpress_Admin_Page
     */
    private $admin_page;

    /**
     * @var Synthpress_Rest_Controller
     */
    private $rest_controller;

    /**
     * Boot the singleton on `plugins_loaded`. Safe to call repeatedly.
     */
    public static function instance() {
        if (self::$instance === null) {
            self::$instance = new self();
            self::$instance->register_hooks();
        }
        return self::$instance;
    }

    /**
     * Private — use {@see instance()}.
     */
    private function __construct() {
        $this->admin_page      = new Synthpress_Admin_Page();
        $this->rest_controller = new Synthpress_Rest_Controller();
    }

    /**
     * Attach WordPress hooks. Kept in one place so the security
     * surface (which actions/filters we touch) is reviewable from a
     * single file.
     */
    private function register_hooks() {
        add_action('init', [$this, 'load_textdomain']);
        add_action('admin_menu', [$this->admin_page, 'register_menu']);
        add_action(
            'admin_enqueue_scripts',
            [$this->admin_page, 'enqueue_assets']
        );
        add_action(
            'rest_api_init',
            [$this->rest_controller, 'register_routes']
        );
    }

    /**
     * Load translations. Translators can ship a `.mo` file via the
     * standard WordPress.org language-pack pipeline.
     */
    public function load_textdomain() {
        load_plugin_textdomain(
            'synthpress',
            false,
            dirname(plugin_basename(SYNTHPRESS_PLUGIN_FILE)) . '/languages'
        );
    }
}
