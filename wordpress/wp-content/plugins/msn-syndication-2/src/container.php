<?php

namespace SynthPress\SyndicationService;

use Monolog\Handler\StreamHandler;
use Monolog\Logger;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

function create_logger(ContainerInterface $c): LoggerInterface
{
	$logger = new Logger("msn-syndication");

	$log = apply_filters('syndication_tool_log_location', WP_CONTENT_DIR . '/msn-syndication.log');
	if (defined('WP_DEBUG_LOG') && WP_DEBUG_LOG === true) {
		$logger->pushHandler(new StreamHandler($log));
	}

	return $logger;
}
