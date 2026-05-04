<?php
// Security check.
if (!defined('ABSPATH')) {
    exit;
}

function add_raw_content_to_api_response($response, $post, $request)
{
    // First, check if the user has permission to view raw content.
    if (current_user_can('edit_post', $post->ID)) {
        // Add the raw content to the response.
        $response->data['content']['rawconfleko'] = wpautop($post->post_content);
    }

    return $response;
}
add_filter('rest_prepare_post', 'add_raw_content_to_api_response', 10, 3);
