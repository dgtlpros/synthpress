<?php

namespace SynthPress\SyndicationService\Utils;

use WP_Post;

interface ParserInterface
{
	public function parse(WP_Post $post): array;
}
