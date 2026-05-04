<?php
// Security check.
if (!defined('ABSPATH')) {
    exit;
}
function my_custom_meta_description() {
    if (is_single() || is_page()) {
        global $post;
        $description_content = '';

        if (is_single()) {
            // Use the post excerpt for the meta description.
            $description_content = get_the_excerpt($post->ID);
        } elseif (is_page()) {
            // Try to get a custom field named 'meta_description'. If it doesn't exist, use the content.
            $description_content = get_post_meta($post->ID, 'meta_description', true) ?: wp_trim_words($post->post_content, 55);
        }

        // Ensure the description content is properly escaped for HTML attributes.
        $description_content = esc_attr(strip_tags($description_content));

        // Print the meta description HTML tag.
        echo '<meta name="description" content="' . $description_content . '">' . "\n";
    }
}
add_action('wp_head', 'my_custom_meta_description');
