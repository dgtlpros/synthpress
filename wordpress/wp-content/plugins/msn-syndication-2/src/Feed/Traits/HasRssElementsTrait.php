<?php

namespace SynthPress\SyndicationService\Feed\Traits;

use Closure;

use function VeeWee\Xml\Writer\Builder\attribute;
use function VeeWee\Xml\Writer\Builder\children;
use function VeeWee\Xml\Writer\Builder\prefixed_element;
use function VeeWee\Xml\Writer\Builder\element;
use function VeeWee\Xml\Writer\Builder\cdata;
use function VeeWee\Xml\Writer\Builder\value;

trait HasRssElementsTrait
{
	protected function fragment_channelMeta(): array
	{
		$langage = apply_filters('syndication_tool_channel_language', 'en');
		$ttl = apply_filters('syndication_tool_channel_ttl', '1');
		$feed_date = get_feed_build_date('D, d M Y H:i:s +0000');

		return [
			element('pubDate', value($feed_date)),
			element('language', value($langage)),
			element('ttl', value($ttl)),
		];
	}

	protected function fragment_channelInfo(): array
	{
		$channel = apply_filters("syndication_tool_feed_data", [
			'title' => get_bloginfo_rss('title'),
			'feed' => get_bloginfo_rss('url') . '/syndication/msn/' . get_query_var('msn_feed'),
			'blog_url' => get_bloginfo_rss('url'),
			'description' => get_bloginfo_rss('description'),
		], 'channel');

		return [
			element('title', value($channel['title'])),
			prefixed_element(
				'atom',
				'link',
				attribute('href', $channel['feed']),
				attribute('rel', 'self'),
				attribute('type', 'application/rss+xml')
			),
			element('link', value($channel['blog_url'])),
			element('description', cdata(value($channel['description']))),
		];
	}

	protected function fragment_channelImage(): Closure
	{
		$image = apply_filters("syndication_tool_feed_data", [
			'src' => get_bloginfo_rss('url'),
			'title' => get_bloginfo_rss('title'),
			'link' => get_bloginfo_rss('url'),
		], 'image');


		return element('image', children([
			element('url', value($image['src'])),
			element('title', value($image['title'])),
			element('link', value($image['link'])),
		]));
	}
}
