<?php

namespace SynthPress\SyndicationService\Stores;

if (!defined('ABSPATH')) {
	exit; // Exit if accessed directly.
}

final class PostDataStore
{
	/**
	 * Class Constructor
	 **/
	public function __construct()
	{
		add_action('init', array(static::class, 'register_meta_fields'));
	}

	/** 
	 * @return void  
	 **/
	public static function register_meta_fields(): void
	{
		register_meta('post', 'syndication_tool_enabled',  [
			'show_in_rest' => true,
			'type' => 'boolean',
			'default' => false,
			'single' => true
		]);

		register_meta('post', 'syndication_tool_title',  [
			'show_in_rest' => true,
			'type' => 'string',
			'default' => "",
			'single' => true
		]);

		register_meta('post', 'syndication_tool_excerpt',  [
			'show_in_rest' => true,
			'type' => 'string',
			'default' => "",
			'single' => true
		]);

		register_meta('post', 'syndication_tool_featured_image',  [
			'show_in_rest' => true,
			'type' => 'integer',
			'single' => true
		]);

		register_meta('post', 'syndication_tool_publish_date',  [
			'show_in_rest' => true,
			'type' => 'string',
			'default' => "",
			'single' => true
		]);

		register_meta('post', 'syndication_tool_schema_types',  [
			'single'       => true,
			'type'         => 'array',
			'show_in_rest' => array(
				'schema' => array(
					'type'  => 'array',
					'items' => array(
						'type' => 'string',
					),
				),
			),
		]);

		register_meta('post', 'syndication_tool_backlink_enable',  [
			'show_in_rest' => true,
			'type' => 'boolean',
			'default' => boolval(get_option('syndication_tool_backlink_enable')),
			'single' => true
		]);

		register_meta('post', 'syndication_tool_ai_disclosure_enable',  [
			'show_in_rest' => true,
			'type' => 'boolean',
			'default' => boolval(get_option('syndication_tool_ai_disclosure_enable')),
			'single' => true
		]);

		register_meta('post', 'syndication_tool_ai_disclosure_text',  [
			'show_in_rest' => true,
			'type' => 'string',
			'default' => get_option('syndication_tool_ai_disclosure_text'),
			'single' => true
		]);
	}

	/** 
	 * @return array  
	 **/
	public static function get_schema_types(): array
	{
		return apply_filters('syndication_tool_schema_types', ['article', 'gallery']);
	}
}
