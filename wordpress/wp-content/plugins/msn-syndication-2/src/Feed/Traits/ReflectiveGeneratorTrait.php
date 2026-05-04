<?php

namespace SynthPress\SyndicationService\Feed\Traits;

use SynthPress\SyndicationService\Attributes\FragmentOrder;
use ReflectionClass;

trait ReflectiveGeneratorTrait
{
	/** 
	 * @return array  
	 **/
	private function get_fragments(): array
	{
		$this->get_ordered_generators();

		$children = [];

		foreach ($this->get_ordered_generators() as [$order, $generator]) {
			$fragments = $generator();

			if (is_array($fragments)) {
				$children = array_merge($children, $fragments);
			}

			if (is_callable($fragments)) {
				$children[] = $fragments;
			}
		}

		return $children;
	}

	/**
	 * @param string $prefix 
	 * @return array 
	 */
	private function get_ordered_generators(string $prefix = 'fragment_'): array
	{
		$reflection = new ReflectionClass($this);

		$generators = [];
		foreach ($reflection->getMethods() as $method) {
			if (!str_starts_with($method->getShortName(), $prefix)) {
				continue;
			}

			// LINQ Anyone??
			$attributes = array_map(
				fn ($attr) => $attr->newInstance(),
				array_filter(
					$method->getAttributes(),
					fn ($attr) => $attr->getName() === FragmentOrder::class
				)
			);

			$generators[] = [
				empty($attributes) ? FragmentOrder::DEFAULT_ORDER : $attributes[0]->order,
				$method->getClosure($this)
			];
		}

		usort($generators, array(self::class, 'compare_generator_order'));

		return apply_filters('syndication_tool_generators', $generators, $this, $prefix);
	}

	/**
	 * @param mixed $a 
	 * @param mixed $b 
	 * @return int 
	 */
	private static function compare_generator_order($a, $b): int
	{
		if ($a[0] > $b[0]) return 1;
		if ($a[0] === $b[0]) return 0;
		if ($a[0] < $b[0]) return -1;
	}
}
