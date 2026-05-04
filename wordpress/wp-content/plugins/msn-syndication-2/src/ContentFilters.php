<?php

namespace SynthPress\SyndicationService;

use DateTime;
use WP_Post;

if (!defined('ABSPATH')) {
	exit; // Exit if accessed directly.
}

/** @package SynthPress\SyndicationService */
class ContentFilters
{
	public function __construct()
	{
		add_filter('syndication_tool_post_excerpt', [static::class, 'filter_post_excerpt'], 10, 2);
		add_filter('syndication_tool_post_title', [static::class, 'filter_post_title'], 10, 2);
		add_filter('syndication_tool_post_thumbnail', [static::class, 'filter_post_thumbnail'], 10, 2);
		add_filter('syndication_tool_post_date', [static::class, 'filter_post_date'], 10, 2);
		add_filter('syndication_tool_post_content', [static::class, 'strip_comments'], 10);

		add_filter('syndication_tool_media_children_items', [static::class, 'add_backlink_to_last_slide'], 10, 2);
		add_filter('syndication_tool_media_children_items', [static::class, 'add_ai_disclosure_to_last_slide'], 10, 2);
	}

	/**
	 * @param string $value 
	 * @param WP_Post $post 
	 * @return string 
	 */
	public static function filter_post_excerpt(string $value, WP_Post $post): string
	{
		$blocks = parse_blocks($post->post_content);

		if ($blocks) {
			$paragraphs = [];
			foreach ($blocks as $index => $block) {
				if ($index === 0 && $block['blockName'] === 'core/heading') {
					continue;
				}

				if ($index > 0 && $block['blockName'] === 'core/heading') {
					break;
				}

				if ($block['blockName'] !== 'core/paragraph') {
					continue;
				}

				$paragraphs[] = $block['innerHTML'];
			}

			if (!empty($paragraphs)) {
				$value = implode("\n", $paragraphs);
			}
		}

		return self::custom_meta_filter($post->ID, 'excerpt', $value);
	}

	/**
	 * @param string $value 
	 * @param WP_Post $post 
	 * @return string 
	 */
	public static function filter_post_title(string $value, WP_Post $post): string
	{
		return self::custom_meta_filter($post->ID, 'title', $value);
	}

	/**
	 * @param string $value 
	 * @param WP_Post $post 
	 * @return string 
	 */
	public static function filter_post_thumbnail($image_id, WP_Post $post)
	{
		return self::custom_meta_filter($post->ID, 'featured_image', $image_id);
	}

	/**
	 * @param string $value 
	 * @param WP_Post $post 
	 * @return string 
	 */
	public static function filter_post_date(string $value, WP_Post $post): string
	{
		$date = self::custom_meta_filter($post->ID, 'publish_date', false);
		if (!$date) {
			return $value;
		}

		$date = new DateTime($date);
		return $date->format('Y-m-d H:i:s');
	}

	/**
	 * @param string $value 
	 * @return string 
	 */
	public static function strip_comments(string $value): string
	{
		return preg_replace('/\n?<!--(.*)-->\n?/Uis', '', $value);
	}

	/**
	 * @param array $images 
	 * @param WP_Post $post 
	 * @return array 
	 */
	public static function add_backlink_to_last_slide(array $images, WP_Post $post)
	{
		if (!static::get_meta_default($post->ID, 'syndication_tool_backlink_enable')) {
			return $images;
		}

		$tags = [
			'SITE_LINK' => sprintf(
				'<a href="%1$s">%2$s</a>',
				get_bloginfo('url'),
				get_bloginfo('site_name')
			),
			'POST_LINK' => sprintf(
				'<a href="%1$s">%2$s</a>',
				get_the_permalink($post),
				esc_html($post->post_title),
			)
		];

		$template = get_option(
			'syndication_tool_backlink_text',
			'<p>The post {{POST_LINK}} appeared first on {{SITE_LINK}}.</p>'
		);

		foreach ($tags as $placeholder => $value) {
			$template = str_replace('{{' . $placeholder . '}}', $value, $template);
		}

		return self::patch_last_image_caption($images, $template);
	}

	/**
	 * @param array $images 
	 * @param WP_Post $post 
	 * @return array 
	 */
	public static function add_ai_disclosure_to_last_slide(array $images, WP_Post $post)
	{
		if (!static::get_meta_default($post->ID, 'syndication_tool_ai_disclosure_enable')) {
			return $images;
		}

		$template = get_option(
			'syndication_tool_ai_disclosure_text',
			'This content was created with the assistance of AI tools and thoroughly edited by a human'
		);

		return self::patch_last_image_caption($images, sprintf(
			'<p>%1$s</p>',
			wp_kses_post($template),
		));
	}

	/**
	 * Add content to the last image in a slide deck, safely.
	 * @param array $images 
	 * @param string $content 
	 * @return array 
	 */
	private static function patch_last_image_caption(array $images, string $content): array
	{
		if (count($images) < 1) {
			return $images;
		}

		$last_index = count($images) - 1;

		if (!isset($images[$last_index])) {
			return $images;
		}

		$images[$last_index]['caption'] .= $content;

		return $images;
	}

	/**
	 * @param int $post_id 
	 * @param string $key 
	 * @param mixed $default 
	 * @return mixed 
	 */
	private static function get_meta_default(int $post_id, string $key, mixed $default = false)
	{
		$meta = get_post_meta($post_id, $key, true);
		if (is_string($meta)) {
			return $meta;
		}

		$option = get_option($key);
		if (is_string($option)) {
			return $option;
		}

		return $default;
	}

	/**
	 * @param mixed $post_id 
	 * @param mixed $key 
	 * @param mixed $value 
	 * @return mixed 
	 */
	private static function custom_meta_filter($post_id, $key, $value)
	{
		if (!$post_id) {
			return $value;
		}

		$meta_value = get_post_meta($post_id, 'syndication_tool_' . $key, true);
		if (!empty($meta_value)) {
			$value = $meta_value;
		}

		return $value;
	}
}
