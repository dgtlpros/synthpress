<?php

namespace SynthPress\SyndicationService\Attributes;

use Attribute;

#[Attribute]
class FragmentOrder
{
	public const DEFAULT_ORDER = 50;

	public function __construct(public ?string $order)
	{
	}
}
