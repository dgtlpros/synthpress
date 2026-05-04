<?php

namespace SynthPress\SyndicationService\Feed;

use Closure;
use WP_Post;
use XMLWriter;

use SynthPress\SyndicationService\Utils\BlockMediaParser;
use SynthPress\SyndicationService\Utils\LegacyMediaParser;
use VeeWee\Xml\Exception\RuntimeException;

use function VeeWee\Xml\Writer\Builder\attribute;
use function VeeWee\Xml\Writer\Builder\children;
use function VeeWee\Xml\Writer\Builder\element;
use function VeeWee\Xml\Writer\Builder\prefixed_element;
use function VeeWee\Xml\Writer\Builder\cdata;
use function VeeWee\Xml\Writer\Builder\value;

class ArticleGenerator extends FeedGeneratorAbstract
{
	public function __construct(
		protected BlockMediaParser $blockMediaParser,
		protected LegacyMediaParser $legacyMediaParser,
	) {
		$this->register_namespace('media', "http://search.yahoo.com/mrss/");
		$this->register_namespace('content', "http://purl.org/rss/1.0/modules/content/");
		$this->register_namespace('mi', "http://schemas.ingestion.microsoft.com/common/");
		$this->register_namespace('dc', "http://purl.org/dc/elements/1.1/");
	}

	/**
	 * @param WP_Post $post 
	 * @return Closure 
	 * @throws RuntimeException 
	 */
	protected function item(WP_Post $post): Closure
	{
		$excerpt = apply_filters('syndication_tool_post_excerpt', get_the_excerpt($post), $post);
		$title = apply_filters('syndication_tool_post_title', get_the_title($post), $post);
		$content = apply_filters('syndication_tool_post_content', $post->post_content, $post);

		$date = apply_filters('syndication_tool_post_date', get_post_time('Y-m-d H:i:s', true, $post), $post, '');
		$date = mysql2date('D, d M Y H:i:s +0000', $date, false);

		return element(
			'item',
			children([
				element('guid', value(get_the_guid($post))),
				element('title', cdata(value($title))),
				element('link', cdata(value(get_the_permalink($post)))),
				element('description', cdata(value($excerpt))),
				element('pubDate', value($date)),
				prefixed_element('content', 'encoded', cdata(value($content))),

				prefixed_element('dc', 'language', value(get_bloginfo('language'))),
				prefixed_element('mi', 'shortTitle', cdata(value($title))),
				$this->category($post),
				$this->author($post),
				...$this->featuredImage($post, $excerpt),
				...$this->media_children($post)
			])
		);
	}

	/**
	 * @param WP_Post $post
	 * @return Closure(XMLWriter $0): Generator<bool> 
	 */
	protected function author(WP_Post $post)
	{
		$author = get_the_author_meta('display_name', $post->post_author);
		$author = apply_filters('syndication_tool_author_name', $author, $post->post_author);

		return prefixed_element('dc', 'creator', cdata(value($author)));
	}

	protected function category($post)
	{
		$categories = get_the_category($post->ID);
		$category = !empty($categories) ? $categories[0]->name : 'Uncategorized';

		return element('category', cdata(value($category)));
	}

	/**
	 * @param WP_Post $post 
	 * @return array<array-key, \Closure(\XMLWriter $0): \Generator<bool>> 
	 * @throws RuntimeException 
	 */
	protected function media_children(WP_Post $post)
	{

		$items   = $this->get_parser($post->post_content)->parse($post);

		return array_map(
			fn($atts) => $this->media_item($atts),
			apply_filters('syndication_tool_media_children_items', $items, $post)
		);
	}

	protected function featuredImage(WP_Post $post, string $excerpt = '')
	{
		$image_id = apply_filters('syndication_tool_post_thumbnail', get_post_thumbnail_id($post), $post);
		if (empty($image_id) || $image_id === 0) {
			return [];
		}

		$attachment = get_post($image_id, 'full');
		list($src, $width, $height) = wp_get_attachment_image_src($image_id, 'full');
		if (empty($attachment) || !isset($src)) {
			return [];
		}

		$title = apply_filters('syndication_tool_post_title', get_the_title($post), $post);

		return [
			$this->media_item([
				'src' => $src,
				'mime' => $attachment->post_mime_type,
				'credit' => $attachment->post_title,
				'title' => $title,
				'caption' => strip_tags($excerpt),
			])
		];
	}
	/**
	 * @param array $atts 
	 * @return Closure(XMLWriter $0): Generator<bool> 
	 */
	protected function media_item(array $atts)
	{
		return prefixed_element(
			'media',
			'content',
			children([
				attribute('url', $atts['src']),
				attribute('type', $atts['mime']),
				attribute('medium', 'image'),
				prefixed_element('media', 'credit', cdata(value($atts['credit']))),
				prefixed_element('media', 'title', cdata(value($atts['title']))),
				prefixed_element('media', 'description', cdata(value($atts['caption']))),
			])
		);
	}

	protected function get_parser(string $content)
	{
		return has_blocks($content) ? $this->blockMediaParser : $this->legacyMediaParser;
	}
}
