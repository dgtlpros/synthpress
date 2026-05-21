<?php
/**
 * Auto-enable MSN syndication for all newly published posts.
 */
if (!defined('ABSPATH')) {
    exit;
}

add_action('transition_post_status', function($new_status, $old_status, $post) {
    if ($new_status === 'publish' && $old_status !== 'publish' && $post->post_type === 'post') {
        update_post_meta($post->ID, 'syndication_tool_enabled', 1);
        update_post_meta($post->ID, 'syndication_tool_schema_types', ['article']);
        update_post_meta($post->ID, 'syndication_tool_ai_disclosure_enable', 1);
        update_post_meta($post->ID, 'syndication_tool_backlink_enable', 1);
    }
}, 10, 3);
