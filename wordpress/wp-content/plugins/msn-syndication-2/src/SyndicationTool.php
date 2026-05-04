<?php

namespace SynthPress\SyndicationService;

use SynthPress\SyndicationService\Controllers\FeedController;
use SynthPress\SyndicationService\Stores\PostDataStore;

if (!defined('ABSPATH')) {
	exit; // Exit if accessed directly.
}

final class SyndicationTool
{
	/**
	 * Class Constructor
	 **/
	public function __construct(
		protected Admin\SettingsPage $settingsPage,
		protected ContentFilters $filterService,
		protected PostDataStore $postStore,
		protected FeedController $feedController,
	) {}

	public function boot($container)
	{
		add_action('enqueue_block_editor_assets', array(static::class, 'enqueue_editor_scripts'));
	}

	/**
	 * @return void  
	 **/
	public static function enqueue_editor_scripts(): void
	{
		$asset_file = include(plugin_dir_path(PLUGIN_CONFIG::PATH) . 'gutenberg/build/index.asset.php');

		wp_enqueue_script(
			'syndication-tool',
			plugins_url('gutenberg/build/index.js', PLUGIN_CONFIG::PATH),
			$asset_file['dependencies'],
			$asset_file['version']
		);
	}
}
