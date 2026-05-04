<?php
// Security check.
if (!defined('ABSPATH')) {
    exit;
}
function lup_add_custom_meta_box()
{
    add_meta_box('lup_recreate_thumbnails', 'Recreate Thumbnails', 'lup_custom_meta_box_html', 'post', 'side');
}
add_action('add_meta_boxes', 'lup_add_custom_meta_box');

function lup_custom_meta_box_html($post)
{
    wp_nonce_field('lup_recreate_thumbnails_action', 'lup_recreate_thumbnails_nonce');
    echo '<button id="lup-recreate-thumbnails-btn" class="button">Recreate Thumbnails</button>';
}
function lup_enqueue_scripts($hook)
{
    if ('post.php' != $hook && 'post-new.php' != $hook) {
        return;
    }
    wp_enqueue_script('lup-custom-script', plugin_dir_url(__FILE__) . 'js/custom-script.js', array('jquery'), null, true);
    wp_localize_script('lup-custom-script', 'lupAjax', array('ajaxurl' => admin_url('admin-ajax.php')));
}
add_action('admin_enqueue_scripts', 'lup_enqueue_scripts');
function lup_recreate_thumbnails_callback()
{
    check_ajax_referer('lup_recreate_thumbnails_action', 'nonce');

    if (isset($_POST['post_id'])) {
        $post_id = intval($_POST['post_id']);
    } else {
        wp_die('No post ID provided');
    }

    $thumbnail_id = get_post_thumbnail_id($post_id);
    if (!$thumbnail_id) {
        wp_die('No featured image set for this post');
    }

    $metadata = wp_generate_attachment_metadata($thumbnail_id, get_attached_file($thumbnail_id));
    if (!empty($metadata)) {
        wp_update_attachment_metadata($thumbnail_id, $metadata);
    }

    wp_die('Thumbnails recreated successfully');
}
add_action('wp_ajax_lup_recreate_thumbnails', 'lup_recreate_thumbnails_callback');
