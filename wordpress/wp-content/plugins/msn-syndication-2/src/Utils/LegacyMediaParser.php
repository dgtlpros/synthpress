<?php

namespace SynthPress\SyndicationService\Utils;

use WP_Post;
use DOMXPath;
use Mimey\MimeTypes;
use Masterminds\HTML5;

if (!defined('ABSPATH')) {
	exit; // Exit if accessed directly.
}

final class LegacyMediaParser implements ParserInterface
{
	private MimeTypes $mimes;
	private HTML5 $parser;

	public function __construct()
	{
		$this->mimes = new MimeTypes;
		$this->parser = new HTML5([
			'encode_entities' => true,
			'disable_html_ns' => true
		]);
	}

	/**
	 * @param WP_Post $content 
	 * @return array 
	 * @throws RuntimeException 
	 */
	public function parse(WP_Post $post): array
	{
		$content = $post->post_content;
		$blocks = explode('<!--nextpage-->', $content);

		$images = [];
		foreach ($blocks as $index => $block) {

			$xpath = $this->create_fragment($block);
			$result = $this->try_parse_fragment($xpath);
			if (!empty($result)) {
				$images[] = $result;
			}
		}

		return $images;
	}

	/**
	 * @param $content string content
	 * @return Xpath 
	 * @throws RuntimeException 
	 */
	protected function create_fragment($content)
	{
		$fragment = '<html>
			<body>
				<div>
				' .  wpautop($content) . '
				</div>
			</body>
		</html>';

		$document = $this->parser->loadHTML($fragment);

		return new DOMXPath($document);
	}

	/**
	 * @param mixed $xpath 
	 * @return array 
	 */
	protected function try_parse_fragment($xpath): array
	{
		$atts = [
			'src' => '',
			'title' => '',
			'caption' => '',
			'credit' => '',
			'mime' => ''
		];

		$imgQuery = $xpath->query('.//img');
		if ($imgQuery->count() == 0) {
			return [];
		}

		$atts['src'] = $imgQuery[0]->getAttribute('src');
		$atts['title'] = $imgQuery[0]->getAttribute('alt');

		// This feels like it belongs elswhere.. A filter perhaps.
		$fileParts = explode(".", $atts['src']);
		$extension = end($fileParts);
		$mime = $this->mimes->getMimeType($extension);
		$atts['mime'] = empty($mime) ? 'image/jpeg' : $mime;

		$headingQuery = $xpath->query('//h2');
		if ($headingQuery->count() > 0) {
			$atts['title'] = $headingQuery[0]->textContent;
		}

		$captionQuery = $xpath->query('//figure/figcaption');
		if ($captionQuery->count() > 0) {
			$atts['credit'] = $captionQuery[0]->textContent;
		}


		foreach ($xpath->query('.//p') as $paragraph) {
			if (empty($paragraph->textContent)) {
				continue;
			}

			$atts['caption'] = $paragraph->textContent;
			break;
		}

		return $atts;
	}
}
