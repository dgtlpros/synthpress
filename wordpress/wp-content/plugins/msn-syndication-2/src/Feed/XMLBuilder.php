<?php

namespace SynthPress\SyndicationService\Feed;

use Closure;
use SynthPress\SyndicationService\Attributes\FragmentOrder;
use SynthPress\SyndicationService\Feed\Traits\ReflectiveGeneratorTrait;
use SynthPress\SyndicationService\Feed\Traits\HasRssElementsTrait;

use WP_Post;
use VeeWee\Xml\Writer\Writer;

use function VeeWee\Xml\Writer\Builder\namespace_attribute;
use function VeeWee\Xml\Writer\Builder\attribute;
use function VeeWee\Xml\Writer\Builder\children;
use function VeeWee\Xml\Writer\Builder\element;
use function VeeWee\Xml\Writer\Mapper\memory_output;


class XMLBuilder
{
	use HasRssElementsTrait, ReflectiveGeneratorTrait;

	protected $namespaces = [
		'mi' => "http://schemas.ingestion.microsoft.com/common/",
		'dc' => "http://purl.org/dc/elements/1.1/",
		'dcterms' => "http://purl.org/dc/terms/",
	];

	public static function generate()
	{
		$instance = new static();
		return $instance->build();
	}

	public function build()
	{
		$children = $this->get_fragments();

		$doc = element('rss', children([
			attribute('version', '2.0'),
			...$children,
		]));

		$writer = Writer::inMemory();
		return $writer->write($doc)->map(memory_output());
	}

	#[FragmentOrder(10)]
	public function fragment_namespaces(): array
	{
		$urls =  array_map(
			fn ($url, $key) => namespace_attribute($url, $key),
			array_values($this->namespaces),
			array_keys($this->namespaces),
		);

		return $urls;
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
}
