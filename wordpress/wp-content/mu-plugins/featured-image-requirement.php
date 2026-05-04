<?php
/**
 * Prevent publishing posts without a featured image.
 * MSN requires images for auto-publish — this is the safety net.
 */
if (!defined('ABSPATH')) exit;

function enforce_featured_image_requirement($post_id) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (wp_is_post_revision($post_id) || !current_user_can('edit_post', $post_id)) return;

    $post_types_requiring_featured_image = array('post');
    if (in_array(get_post_type($post_id), $post_types_requiring_featured_image)) {
        if (!has_post_thumbnail($post_id)) {
            $post_status = get_post_status($post_id);
            if ($post_status == 'publish' || $post_status == 'future') {
                wp_update_post(array(
                    'ID' => $post_id,
                    'post_status' => 'draft'
                ));
            }
            set_transient('missing_featured_image_' . $post_id, true, 30);
        }
    }
}
add_action('save_post', 'enforce_featured_image_requirement');

function display_missing_featured_image_notice() {
    global $post;
    if (empty($post) || !isset($post->ID)) return;

    $message = get_transient('missing_featured_image_' . $post->ID);
    if ($message) {
        echo '<div class="notice notice-error is-dismissible"><p><strong>Featured Image Required:</strong> Please set a featured image before publishing this post.</p></div>';
        delete_transient('missing_featured_image_' . $post->ID);
    }
}
add_action('admin_notices', 'display_missing_featured_image_notice');
