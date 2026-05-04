<?php
// Security check.
if (!defined('ABSPATH')) {
    exit;
}

//<meta name="robots" content="max-image-preview:large">
//this tells discover to use largest image for image preview

function display_last_updated()
{
    global $post;
    $post_modified_time = get_post_modified_time('U', true, $post);
    $formatted_post_modified_time = get_post_modified_time('Y-m-d\TH:i:sP', true, $post);
    $current_time = current_time('timestamp');
    $time_difference = $current_time - $post_modified_time;

    if ($time_difference < DAY_IN_SECONDS) {
        // Query posts published on the same day
        $args = array(
            'date_query' => array(
                array(
                    'year' => date('Y', $post_modified_time),
                    'month' => date('m', $post_modified_time),
                    'day' => date('d', $post_modified_time),
                ),
            ),
            'post_type' => 'post',
            'posts_per_page' => -1, // Get all posts
            'orderby' => 'date',
            'order' => 'DESC',
        );
        $same_day_posts = get_posts($args);

        // Find the index of the current post
        $index = 0;
        foreach ($same_day_posts as $key => $same_day_post) {
            if ($same_day_post->ID == $post->ID) {
                $index = $key + 1;
                break;
            }
        }

        // Calculate the updated time based on the index
        $updated_seconds = 17 * $index;
        $time_string = "vor $updated_seconds  Sekunden";
    } else {
        // More than a day, show in days
        $days = round($time_difference / DAY_IN_SECONDS);
        $time_string = $days > 1 ? "vor $days Tagen" : "vor einem Tag";
    }
    return '<time class="post-last-modified-td" itemprop="dateModified" datetime="' . $formatted_post_modified_time . '">' . $time_string . '</time>';
}

function lup_append_last_updated($content)
{
    if (is_single()) {
        $last_updated = '<p class="post-last-modified">Zuletzt aktualisiert <time class="post-last-modified-td" itemprop="dateModified">' . display_last_updated() . '</time></p>';
        return $last_updated . $content;
    }

    // If not a single post page, return the content unchanged
    return $content;
}
add_filter('the_content', 'lup_append_last_updated');
