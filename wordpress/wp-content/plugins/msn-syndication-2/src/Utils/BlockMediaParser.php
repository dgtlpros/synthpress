<?php

namespace SynthPress\SyndicationService\Utils;

use WP_Post;
use DOMNode;
use DOMXPath;
use Mimey\MimeTypes;
use Masterminds\HTML5;
use Psr\Log\LoggerInterface;

if (!defined('ABSPATH')) {
	exit; // Exit if accessed directly.
}

/** 
 * @package SynthPress\SyndicationService\Utils 
 * */
final class BlockMediaParser implements ParserInterface
{
	/**
	 * 
	 * @var LoggerInterface
	 */
	private LoggerInterface $log;

	/**
	 * 
	 * @var MimeTypes
	 */
	private MimeTypes $mimes;

	/**
	 * 
	 * @var HTML5
	 */
	private HTML5 $parser;

	public function __construct(
		LoggerInterface $log,
		MimeTypes $mimes
	) {
		$this->log = $log;
		$this->mimes = $mimes;

		$this->parser = new HTML5([
			'encode_entities' => true,
			'disable_html_ns' => true
		]);
	}

	/**
	 * @param WP_Post $post 
	 * @return array 
	 * @throws RuntimeException 
	 */
	public function parse(WP_POST $post): array
	{
		$this->log->info('Starting parsing content', ['ID' => $post->ID, 'title' => $post->post_title]);
		$content = $post->post_content;
		$blocks = parse_blocks($content);
		if (!is_array($blocks)) {
			$this->log->info('No blocks found in supplied content', ['content' => $content]);
			return array();
		}

		$separator = apply_filters('syndication_tool_separator', 'core/heading');

		$images = array();
		foreach (self::slice_blocks_by($blocks, $separator) as $slice) {
			$xpath = $this->create_fragment($slice);
			$result = $this->try_parse_fragment($xpath);

			if (!empty($result)) {
				$images[] = $result;
			}
		}

		if (count($images) === 0) {
			$this->log->warning('Parsed content but no images were found');
		}

		$this->log->info('Finished parsing content', ['images' => $images]);

		return apply_filters('syndication_tool_parsed_images', $images);
	}

	/**
	 * @param array $blocks 
	 * @param string $separator 
	 * @return array 
	 */
	private static function slice_blocks_by(array $blocks, string $separator): array
	{
		$current_slice_offset = -1;
		$slices = array();
		foreach ($blocks as $current_block) {

			if (!self::is_approved_block($current_block)) {
				continue;
			}

			if ($current_block['blockName'] === $separator) {
				$current_slice_offset++;
			}

			if ($current_slice_offset < 0) {
				continue;
			}

			if (empty($slices[$current_slice_offset]) || !is_array($slices[$current_slice_offset])) {
				$slices[$current_slice_offset] = array();
			}

			$slices[$current_slice_offset][] = $current_block;
		}
		return $slices;
	}

	/**
	 * @param mixed $block 
	 * @return bool 
	 */
	private static function is_approved_block($block): bool
	{
		return
			is_array($block)
			&& array_key_exists('blockName', $block)
			&& in_array($block['blockName'], [
				'core/heading',
				'core/paragraph',
				'core/image'
			]);
	}

	/**
	 * @param array $before WP_Block Array
	 * @param mixed $current WP_Block Array
	 * @return Xpath 
	 * @throws RuntimeException 
	 */
	protected function create_fragment($blocks)
	{
		$block_html = array_column($blocks, 'innerHTML');

		$document = $this->parser->loadHTML(
			'<html><body>' . implode("\n", $block_html) . '</body></html>'
		);

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

		$imgQuery = $xpath->query('.//figure/img');
		if ($imgQuery->count() == 0) {
			$this->log->info('No images found in fragment', ['fragment' => $xpath]);
			return [];
		}

		$atts['src'] = $imgQuery[0]->getAttribute('src');
		$atts['title'] = $imgQuery[0]->getAttribute('alt');

		// This feels like it belongs elswhere.. A filter perhaps.
		$fileParts = explode(".", $atts['src']);
		$extension = end($fileParts);
		$mime = $this->mimes->getMimeType($extension);
		$atts['mime'] = empty($mime) ? 'image/jpeg' : $mime;

		$headingQuery = $xpath->query('//*[@class="wp-block-heading"]');
		if ($headingQuery->count() > 0) {
			$atts['title'] = $headingQuery[0]->textContent;
		}

		$captionQuery = $xpath->query('//figure/figcaption');
		if ($captionQuery->count() > 0) {
			$atts['credit'] = $captionQuery[0]->textContent;
		}

		$paragraphQuery = $xpath->query('//p');
		if ($paragraphQuery->count() > 0) {
			foreach ($paragraphQuery as $node) {
				$atts['caption'] .= static::fragment_from_node($node);
			}
		}

		return $atts;
	}

	/**
	 * @param DOMNode $node 
	 * @return string 
	 */
	private static function fragment_from_node(DOMNode $node): string
	{
		return $node->ownerDocument->saveXML($node);
	}

	/**
	 * @param mixed $blocks 
	 * @param mixed $currentIndex 
	 * @param mixed $blockType 
	 * @param mixed $direction 
	 * @param int $iterations 
	 * @deprecated
	 * @return mixed 
	 */
	private static function _find_block($blocks, $currentIndex, $blockType, $direction, $iterations = 0)
	{
		$index = $currentIndex + $direction;

		if ($index < 0 || $index > (count($blocks) - 1)) {
			return null;
		}

		if ($blocks[$index]['blockName'] == $blockType) {
			return $blocks[$index];
		}

		if ($iterations > 10) {
			return null;
		}

		$iterations++;

		return self::_find_block($blocks, $index, $blockType, $direction, $iterations);
	}
}
