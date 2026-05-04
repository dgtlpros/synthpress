<?php

namespace SynthPress\SyndicationService\Feed;

use Closure;
use SynthPress\SyndicationService\Attributes\FragmentOrder;
use SynthPress\SyndicationService\Feed\Traits\ReflectiveGeneratorTrait;
use SynthPress\SyndicationService\Feed\Traits\HasRssElementsTrait;
use VeeWee\Xml\Exception\RuntimeException;
use WP_Post;
use VeeWee\Xml\Writer\Writer;

use function VeeWee\Xml\Writer\Builder\namespace_attribute;
use function VeeWee\Xml\Writer\Builder\attribute;
use function VeeWee\Xml\Writer\Builder\children;
use function VeeWee\Xml\Writer\Builder\element;
use function VeeWee\Xml\Writer\Mapper\memory_output;


abstract class FeedGeneratorAbstract
{
	use HasRssElementsTrait, ReflectiveGeneratorTrait;

	protected $namespaces = [
		'atom' => "http://www.w3.org/2005/Atom",
		'dcterms' => "http://purl.org/dc/terms/",
	];

	protected $items = array();

	/**
	 * @return string 
	 * @throws RuntimeException 
	 */
	public static function generate()
	{
		$instance = new static();
		return $instance->build();
	}

	/**
	 * @return string 
	 * @throws RuntimeException 
	 */
	public function build()
	{
		$children = $this->get_fragments();

		$doc = element('rss', children([
			attribute('version', '2.0'),
			...$this->feed_namespaces(),
			element(
				'channel',
				children([
					...$children,
				])
			)
		]));

		$writer = Writer::inMemory();
		return $writer->write($doc)->map(memory_output());
	}

	/**
	 * @return array 
	 */
	public function feed_namespaces(): array
	{
		$urls =  array_map(
			fn ($url, $key) => namespace_attribute($url, $key),
			array_values($this->namespaces),
			array_keys($this->namespaces),
		);

		return $urls;
	}

	/**
	 * @return array 
	 */
	#[FragmentOrder(100)]
	public function fragment_items(): array
	{
		return !empty($this->items) ? array_map([$this, 'item'], $this->items) : [];
	}

	/**
	 * @param mixed $item 
	 * @return void 
	 */
	public function add_item($item): void
	{
		$this->items[] = $item;
	}

	/**
	 * @param string $key 
	 * @param string $url 
	 * @return void 
	 */
	protected function register_namespace(string $key, string $url): void
	{
		$this->namespaces[$key] = $url;
	}

	/** 
	 * @return Closure  
	 **/
	protected abstract function item(WP_Post $item): Closure;
}
