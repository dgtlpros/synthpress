<?php

/**
 * Plugin Name: MSN Syndication Feeds
 * Description: Provides feeds for syndicating content to MSN
 * Version:     0.10.3
 * Author:      SynthPress
 * Text Domain: synthpress-syndication 
 */

namespace SynthPress\SyndicationService;

use DI\Container;
use Psr\Log\LoggerInterface;

if (!defined('ABSPATH')) {
	exit; // Exit if accessed directly.
}

require_once 'vendor/autoload.php';

class PLUGIN_CONFIG
{
	const PATH = __FILE__;
};

$container = new Container([
	LoggerInterface::class => fn($c) => create_logger($c),
]);

$container->get(SyndicationTool::class)->boot($container);
