<?php

namespace SynthPress\SyndicationService\Controllers;

use SynthPress\SyndicationService\Feed\ArticleGenerator;
use SynthPress\SyndicationService\Stores\PostDataStore;

use WP_Query;

if (!defined('ABSPATH')) {
	exit; // Exit if accessed directly.
}

final class FeedController
{
	public function __construct(
		protected ArticleGenerator $generator,
		protected PostDataStore $postStore,
	) {
		add_action('init', array(static::class, 'register_rewrite_rule'));
		add_filter('query_vars', array(static::class, 'register_query_var'));
		add_action('pre_get_posts', array($this, 'filter_query'), 200);
		add_action('template_redirect', array($this, 'render_feed'));

		add_filter('posts_clauses', array($this, 'order_query_by_custom_date'), 100, 2);
	}

	/** 
	 * @return void  
	 **/
	public static function register_rewrite_rule(): void
	{
		add_rewrite_rule('^feed/msn:(article|gallery)/?$', 'index.php?feed=msn&feed_type=$matches[1]', 'top');
	}

	/**
	 * @param array $query_vars 
	 * @return array 
	 */
	public static function register_query_var(array $query_vars): array
	{
		$query_vars[] = 'feed';
		$query_vars[] = 'feed_type';
		return $query_vars;
	}

	/**
	 * @param mixed $query 
	 * @return mixed 
	 */
	public function filter_query($query)
	{
		if (is_admin() || !$query->is_main_query() || get_query_var('feed') !== 'msn') {
			return $query;
		}

		$schema_type = get_query_var('feed_type');
		if (!in_array($schema_type, $this->postStore::get_schema_types())) {
			_doing_it_wrong(__METHOD__, 'Invalid feed schema type: ' . $schema_type, '1.0.0');
		}

		$meta_query = [
			'relation' => 'AND',
			[
				'key' => 'syndication_tool_enabled',
				'value'	=> 1,
				'compare'	=> '=',
			],
			[
				'key' => 'syndication_tool_schema_types',
				'compare' => 'LIKE',
				'value'	=> $schema_type,
			]
		];

		$query->set('meta_query', $meta_query);
		$query->set('orderby', [
			'date' => 'DESC',
		]);

		add_filter('option_posts_per_rss', [static::class, 'posts_per_page']);
	}

	public function order_query_by_custom_date(array $clauses, WP_Query $query): array
	{
		global $wpdb;

		if (is_admin() || !$query->is_main_query() || get_query_var('feed') !== 'msn') {
			return $clauses;
		}

		$clauses['fields'] .= '
			, IF(
				NULLIF(custom_publish_date.meta_value, "") IS NULL, 
				' . $wpdb->prefix . 'posts.post_date,
				CAST(custom_publish_date.meta_value AS DATETIME)
			) as feed_publish_date 	
		';

		$clauses['join'] .= ' 
			LEFT JOIN ' . $wpdb->prefix . 'postmeta AS custom_publish_date ON (
				' . $wpdb->prefix . 'posts.ID = custom_publish_date.post_id
				AND custom_publish_date.meta_key = \'syndication_tool_publish_date\'
			)';

		$clauses['orderby'] = str_replace($wpdb->prefix . 'posts.post_date', 'feed_publish_date', $clauses['orderby']);

		return $clauses;
	}

	/** 
	 * @return int  
	 **/
	public static function posts_per_page()
	{
		return 50;
	}

	/** 
	 * @return void  
	 **/
	public function render_feed()
	{
		if (get_query_var('feed') !== 'msn') {
			return;
		}

		if (isset($_GET['debug_feed_query'])) {
			global $wp_query;
			echo '<!--- ' . $wp_query->request . '--->';
		}

		while (have_posts()) : the_post();
			$this->generator->add_item(get_post());
		endwhile;


		header('Content-Type: application/rss+xml;charset=' . get_bloginfo('charset'));
		echo $this->generator->build();
		die;
	}
}
