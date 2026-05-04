<?php
// Security check.
if (!defined('ABSPATH')) {
    exit;
}

add_action('save_post', 'replace_base64_and_external_images', 10, 2);

function replace_base64_and_external_images($post_id, $post)
{
    static $is_processing = false;

    if ($is_processing) {
        return;
    }

    $is_processing = true;

    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }

    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    if ($post->post_type !== 'post') {
        return;
    }

    $content = $post->post_content;
    $post_title = sanitize_file_name($post->post_title);

    preg_match_all('/src=["\'](data:image\/[a-zA-Z]+;base64,[^"\']+|[^"\']+)["\']/i', $content, $matches);

    if (empty($matches) || !is_array($matches) || !isset($matches[1])) {
        return;
    }

    $upload_dir = wp_upload_dir();
    $site_url = parse_url(get_bloginfo('url'), PHP_URL_HOST);

    foreach ($matches[1] as $index => $image_source) {
        // Clean and normalize the image source URL
        $image_source = html_entity_decode($image_source); // Decode HTML entities
        $image_source = preg_replace('/\s+/', '', $image_source); // Remove any whitespace

        $file_name = '';
        $image_url = '';
        $decoded_image_data = '';
        $extension = '';
        $image_source_url = parse_url($image_source, PHP_URL_HOST);

        $alt_text = '';

        // Find the complete img tag by splitting content into chunks
        $img_tag = '';
        $content_parts = explode('<img', $content);
        foreach ($content_parts as $part) {
            if (strpos($part, $image_source) !== false) {
                $img_tag = '<img' . substr($part, 0, strpos($part, '>') + 1);
                break;
            }
        }

        // Extract alt text from the complete img tag
        preg_match('/alt=["\'](.*?)["\']/', $img_tag, $alt_matches);
        if (!empty($alt_matches) && isset($alt_matches[1])) {
            $alt_text = sanitize_file_name($alt_matches[1]);
        } else {
            $alt_text = $post_title;
        }

        // Handle base64 images
        if (strpos($image_source, 'data:image') === 0) {
            preg_match('/data:image\/([a-zA-Z]+);base64,/', $image_source, $type_matches);
            $extension = $type_matches[1] ?? 'jpg';
            $image_data = substr($image_source, strpos($image_source, ',') + 1);
            $decoded_image_data = base64_decode($image_data);

            // Detect actual image type for base64 images
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $detected_mime = $finfo->buffer($decoded_image_data);
            $extension = str_replace('image/', '', $detected_mime);
            if ($extension === 'jpeg') $extension = 'jpg';
        }
        // Handle external images
        else if ($image_source_url !== $site_url) {
            // Check if image was previously imported
            $existing_import = confleko_get_import_log_by_url($image_source);
            if ($existing_import) {
                // Use the previously imported image URL
                $image_url = $existing_import->new_url;
                
                // Update the image tag with the existing URL
                $img_tag = $matches[0][$index];
                $new_img_tag = preg_replace('/src=["\'].*?["\']/', 'src="' . esc_url($image_url) . '"', $img_tag);
                
                // Remove srcset and sizes attributes
                $new_img_tag = preg_replace('/srcset=["\'].*?["\']/', '', $new_img_tag);
                $new_img_tag = preg_replace('/sizes=["\'].*?["\']/', '', $new_img_tag);
                
                if (!preg_match('/ alt=/', $img_tag)) {
                    $new_img_tag = str_replace('<img ', '<img alt="' . esc_attr($post->post_title) . '" ', $new_img_tag);
                }
                
                if (!preg_match('/ title=/', $img_tag)) {
                    $new_img_tag = str_replace('<img ', '<img title="' . esc_attr($post->post_title) . '" ', $new_img_tag);
                }
                
                $content = str_replace($img_tag, $new_img_tag, $content);
                continue;
            }

            $response = wp_remote_get($image_source);

            if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
                error_log('Image download failed for ' . $image_source);
                continue;
            }

            $decoded_image_data = wp_remote_retrieve_body($response);

            // Detect actual image type using fileinfo
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $detected_mime = $finfo->buffer($decoded_image_data);

            // Set extension based on actual MIME type
            switch ($detected_mime) {
                case 'image/jpeg':
                    $extension = 'jpg';
                    break;
                case 'image/png':
                    $extension = 'png';
                    break;
                case 'image/webp':
                    $extension = 'webp';
                    break;
                case 'image/gif':
                    $extension = 'gif';
                    break;
                default:
                    error_log('Unknown image type: ' . $detected_mime);
                    continue 2;
            }
        } else {
            continue;
        }

        $counter = 0;
        do {
            //$file_name = $post_title . ($counter ? "_$counter" : '') . '.' . $extension;
            $file_name = $alt_text . ($counter ? "_$counter" : '') . '.' . $extension;

            $upload = wp_upload_bits($file_name, null, $decoded_image_data);
            $counter++;
        } while (!empty($upload['error']) && $upload['error'] === 'File already exists');

        if (!empty($upload['error'])) {
            error_log('Image upload failed: ' . $upload['error']);
            continue;
        }

        $file_path = $upload['file'];
        $image_url = $upload_dir['url'] . '/' . basename($file_path);

        // Log the imported image
        if ($image_source_url !== $site_url) {
            confleko_add_import_log($image_source, $image_url);
        }

        $attachment = array(
            'post_mime_type' => 'image/' . $extension,
            'post_title'     => $file_name,
            'post_content'   => '',
            'post_status'    => 'inherit'
        );

        $attach_id = wp_insert_attachment($attachment, $file_path, $post_id);
        if ($attach_id === 0) {
            error_log('Failed to insert attachment.');
            continue;
        }

        require_once(ABSPATH . 'wp-admin/includes/image.php');
        $attach_data = wp_generate_attachment_metadata($attach_id, $file_path);
        wp_update_attachment_metadata($attach_id, $attach_data);

        $img_tag = $matches[0][$index];
        $new_img_tag = preg_replace('/src=["\'].*?["\']/', 'src="' . esc_url($image_url) . '"', $img_tag);

        // Remove srcset and sizes attributes
        $new_img_tag = preg_replace('/srcset=["\'].*?["\']/', '', $new_img_tag);
        $new_img_tag = preg_replace('/sizes=["\'].*?["\']/', '', $new_img_tag);

        if (!preg_match('/ alt=/', $img_tag)) {
            $new_img_tag = str_replace('<img ', '<img alt="' . esc_attr($post->post_title) . '" ', $new_img_tag);
        }

        if (!preg_match('/ title=/', $img_tag)) {
            $new_img_tag = str_replace('<img ', '<img title="' . esc_attr($post->post_title) . '" ', $new_img_tag);
        }

        $content = str_replace($img_tag, $new_img_tag, $content);
    }

    wp_update_post(array(
        'ID'           => $post_id,
        'post_content' => $content
    ));

    $is_processing = false;
}

// Register admin menu
add_action('admin_menu', 'register_image_extension_fixer_menu');

function register_image_extension_fixer_menu()
{
    add_management_page(
        'Fix Image Extensions',
        'Fix Image Extensions',
        'manage_options',
        'fix-image-extensions',
        'render_image_extension_fixer_page'
    );
}

function render_image_extension_fixer_page()
{
    $items_per_page = 50;
    $offset = isset($_GET['offset']) ? intval($_GET['offset']) : 0;
    $hide_jpeg_mismatches = isset($_GET['hide_jpeg']) ? filter_var($_GET['hide_jpeg'], FILTER_VALIDATE_BOOLEAN) : false;

    // Handle form submission
    if (isset($_POST['fix_images']) && check_admin_referer('fix_image_extensions')) {
        $processed = process_image_fixes($_POST['images'] ?? []);
        echo '<div class="notice notice-success"><p>Processed ' . $processed . ' images.</p></div>';
    }

    $mismatched_images = [];
    $batch_size = 100; // Process 100 images at a time
    $current_offset = 0;

    // Keep fetching until we have enough mismatches or run out of images
    while (count($mismatched_images) < $items_per_page) {
        $args = array(
            'post_type' => 'attachment',
            'post_mime_type' => 'image',
            'posts_per_page' => $batch_size,
            'offset' => $current_offset,
            'post_status' => 'any'
        );

        $query = new WP_Query($args);

        if (!$query->have_posts()) {
            break; // No more images to check
        }

        foreach ($query->posts as $attachment) {
            $file_path = get_attached_file($attachment->ID);
            if (!file_exists($file_path)) continue;

            // Detect actual mime type
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $actual_mime = $finfo->file($file_path);
            $current_mime = get_post_mime_type($attachment->ID);

            // Get current file extension
            $current_extension = strtolower(pathinfo($file_path, PATHINFO_EXTENSION));

            // Get expected extension for the actual mime type
            $expected_extension = '';
            switch ($actual_mime) {
                case 'image/jpeg':
                case 'image/jpg':
                    $expected_extension = 'jpg'; // We'll compare against both jpg and jpeg later
                    break;
                case 'image/png':
                    $expected_extension = 'png';
                    break;
                case 'image/webp':
                    $expected_extension = 'webp';
                    break;
                case 'image/gif':
                    $expected_extension = 'gif';
                    break;
                default:
                    continue;
            }

            // Check if this is a real mismatch (not just jpg/jpeg variation)
            $is_jpeg_only_mismatch = ($current_extension === 'jpg' || $current_extension === 'jpeg') &&
                ($actual_mime === 'image/jpeg' || $actual_mime === 'image/jpg');

            // Skip if it's only a jpg/jpeg mismatch and hide_jpeg_mismatches is true
            if ($hide_jpeg_mismatches && $is_jpeg_only_mismatch) {
                continue;
            }

            // Add to mismatched_images if extension doesn't match actual type
            if (
                !$is_jpeg_only_mismatch &&
                $current_extension !== $expected_extension &&
                !($current_extension === 'jpeg' && $expected_extension === 'jpg')
            ) {
                // Find posts where this image is used
                $used_in_posts = get_posts([
                    'post_type' => 'any',
                    'posts_per_page' => -1,
                    'post_status' => 'any',
                    's' => basename($file_path)
                ]);

                $usage_links = array_map(function ($post) {
                    return sprintf(
                        '<a href="%s" target="_blank">%s</a>',
                        get_edit_post_link($post->ID),
                        esc_html($post->post_title)
                    );
                }, $used_in_posts);

                $mismatched_images[] = [
                    'id' => $attachment->ID,
                    'title' => $attachment->post_title,
                    'current_mime' => $current_mime,
                    'actual_mime' => $actual_mime,
                    'file_path' => $file_path,
                    'url' => wp_get_attachment_url($attachment->ID),
                    'usage' => $usage_links
                ];
            }

            if (count($mismatched_images) >= $items_per_page) {
                break 2; // Break both foreach and while loops
            }
        }

        $current_offset += $batch_size;
    }

    // Modify the form section:
?>
    <div class="wrap">
        <h1>Fix Image Extensions</h1>
        <?php if (empty($mismatched_images)): ?>
            <p>No images with incorrect extensions were found.</p>
        <?php else: ?>
            <form method="post" action="" id="fix-images-form">
                <?php wp_nonce_field('fix_image_extensions'); ?>
                <div class="tablenav top">
                    <div class="alignleft actions">
                        <button type="button" id="select-all" class="button">Select All</button>
                        <button type="button" id="select-next-10" class="button">Select +10</button>
                        <input type="submit" name="fix_images" class="button button-primary" value="Fix Selected Images">
                    </div>
                </div>
                <table class="wp-list-table widefat fixed striped">
                    <thead>
                        <tr>
                            <th><input type="checkbox" id="select-all-checkbox"></th>
                            <th>Image</th>
                            <th>Current Extension</th>
                            <th>Detected Type</th>
                            <th>Used In</th>
                        </tr>
                    </thead>
                    <tbody id="images-list">
                        <?php foreach ($mismatched_images as $image): ?>
                            <tr>
                                <td>
                                    <input type="checkbox" name="images[]" value="<?php echo esc_attr($image['id']); ?>">
                                </td>
                                <td>
                                    <img src="<?php echo esc_url($image['url']); ?>" style="max-width: 100px;">
                                    <br>
                                    <?php echo esc_html($image['title']); ?>
                                </td>
                                <td><?php echo esc_html($image['current_mime']); ?></td>
                                <td><?php echo esc_html($image['actual_mime']); ?></td>
                                <td><?php echo !empty($image['usage']) ? implode('<br>', $image['usage']) : 'Not used'; ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
                <?php if (count($query->posts) === ($offset === 0 ? $items_per_page : 20)): ?>
                    <div class="tablenav bottom">
                        <div class="alignleft">
                            <button type="button" id="load-more" class="button"
                                data-offset="<?php echo $offset + ($offset === 0 ? $items_per_page : 20); ?>">
                                Load More
                            </button>
                        </div>
                    </div>
                <?php endif; ?>
            </form>
            <script>
                jQuery(document).ready(function($) {
                    $('#select-all').click(function() {
                        $('input[name="images[]"]').prop('checked', true);
                    });

                    $('#select-all-checkbox').change(function() {
                        $('input[name="images[]"]').prop('checked', this.checked);
                    });

                    $('#select-next-10').click(function() {
                        var unchecked = $('input[name="images[]"]:not(:checked)');
                        unchecked.slice(0, 10).prop('checked', true);
                    });

                    function isJpegMismatch($row) {
                        var currentMime = $row.find('td:eq(2)').text(); // Current Extension column
                        var detectedMime = $row.find('td:eq(3)').text(); // Detected Type column
                        return (currentMime.includes('jpeg') && detectedMime.includes('jpeg')) ||
                            (currentMime.includes('jpg') && detectedMime.includes('jpeg')) ||
                            (currentMime.includes('jpeg') && detectedMime.includes('jpg'));
                    }

                    $('#hide-jpeg-mismatches').change(function() {
                        var isChecked = $(this).prop('checked');
                        // Reload the initial data with the new filter
                        window.location.href = updateQueryStringParameter(window.location.href, 'hide_jpeg', isChecked);
                    });

                    $('#load-more').click(function() {
                        var button = $(this);
                        var offset = button.data('offset');
                        var hideJpegMismatches = $('#hide-jpeg-mismatches').prop('checked');

                        $.ajax({
                            url: window.location.href,
                            data: {
                                offset: offset,
                                action: 'load_more_images',
                                hide_jpeg: hideJpegMismatches
                            },
                            success: function(response) {
                                if (response.trim()) {
                                    $('#images-list').append(response);
                                    button.data('offset', offset + 20);
                                } else {
                                    button.remove();
                                }
                            }
                        });
                    });

                    // Helper function to update URL parameters
                    function updateQueryStringParameter(uri, key, value) {
                        var re = new RegExp("([?&])" + key + "=.*?(&|$)", "i");
                        var separator = uri.indexOf('?') !== -1 ? "&" : "?";
                        if (uri.match(re)) {
                            return uri.replace(re, '$1' + key + "=" + value + '$2');
                        }
                        return uri + separator + key + "=" + value;
                    }
                });
            </script>
        <?php endif; ?>
    </div>
<?php
}

// Add this new function to handle AJAX requests
add_action('wp_ajax_load_more_images', 'load_more_mismatched_images');
function load_more_mismatched_images()
{
    if (!current_user_can('manage_options')) {
        wp_die();
    }

    $items_per_page = 20;
    $offset = isset($_GET['offset']) ? intval($_GET['offset']) : 0;
    $hide_jpeg_mismatches = isset($_GET['hide_jpeg']) ? filter_var($_GET['hide_jpeg'], FILTER_VALIDATE_BOOLEAN) : false;

    $mismatched_images = [];
    $batch_size = 100;
    $current_offset = $offset;

    while (count($mismatched_images) < $items_per_page) {
        $args = array(
            'post_type' => 'attachment',
            'post_mime_type' => 'image',
            'posts_per_page' => $batch_size,
            'offset' => $current_offset,
            'post_status' => 'any'
        );

        $query = new WP_Query($args);

        if (!$query->have_posts()) {
            break;
        }

        foreach ($query->posts as $attachment) {
            $file_path = get_attached_file($attachment->ID);
            if (!file_exists($file_path)) continue;

            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $actual_mime = $finfo->file($file_path);
            $current_mime = get_post_mime_type($attachment->ID);
            $current_extension = strtolower(pathinfo($file_path, PATHINFO_EXTENSION));

            if ($hide_jpeg_mismatches) {
                if (($current_extension === 'jpg' || $current_extension === 'jpeg') &&
                    $actual_mime === 'image/jpeg'
                ) {
                    continue;
                }
            }

            $expected_extension = '';
            switch ($actual_mime) {
                case 'image/jpeg':
                    $expected_extension = 'jpg';
                    break;
                case 'image/png':
                    $expected_extension = 'png';
                    break;
                case 'image/webp':
                    $expected_extension = 'webp';
                    break;
                case 'image/gif':
                    $expected_extension = 'gif';
                    break;
                default:
                    continue;
            }

            if (
                $actual_mime !== $current_mime ||
                ($current_extension !== $expected_extension &&
                    !($current_extension === 'jpeg' && $expected_extension === 'jpg'))
            ) {
                $used_in_posts = get_posts([
                    'post_type' => 'any',
                    'posts_per_page' => -1,
                    'post_status' => 'any',
                    's' => basename($file_path)
                ]);

                $usage_links = array_map(function ($post) {
                    return sprintf(
                        '<a href="%s" target="_blank">%s</a>',
                        get_edit_post_link($post->ID),
                        esc_html($post->post_title)
                    );
                }, $used_in_posts);

                $mismatched_images[] = [
                    'id' => $attachment->ID,
                    'title' => $attachment->post_title,
                    'current_mime' => $current_mime,
                    'actual_mime' => $actual_mime,
                    'file_path' => $file_path,
                    'url' => wp_get_attachment_url($attachment->ID),
                    'usage' => $usage_links
                ];
            }

            if (count($mismatched_images) >= $items_per_page) {
                break 2;
            }
        }

        $current_offset += $batch_size;
    }

    // Render the rows...
}

function process_image_fixes($image_ids)
{
    if (empty($image_ids)) return 0;

    $processed = 0;
    foreach ($image_ids as $attachment_id) {
        $file_path = get_attached_file($attachment_id);
        if (!file_exists($file_path)) continue;

        // Detect actual mime type
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $actual_mime = $finfo->file($file_path);

        // Get correct extension
        $extension = '';
        switch ($actual_mime) {
            case 'image/jpeg':
                $extension = 'jpg';
                break;
            case 'image/png':
                $extension = 'png';
                break;
            case 'image/webp':
                $extension = 'webp';
                break;
            case 'image/gif':
                $extension = 'gif';
                break;
            default:
                continue 2;
        }

        // Generate new filename
        $directory = dirname($file_path);
        $filename = pathinfo(basename($file_path), PATHINFO_FILENAME);
        $new_file_path = $directory . '/' . $filename . '.' . $extension;

        // Rename the file
        if (rename($file_path, $new_file_path)) {
            // Update attachment metadata
            update_attached_file($attachment_id, $new_file_path);
            wp_update_attachment_metadata($attachment_id, wp_generate_attachment_metadata($attachment_id, $new_file_path));
            wp_update_post([
                'ID' => $attachment_id,
                'post_mime_type' => $actual_mime
            ]);

            // Update any posts that reference this image
            $posts = get_posts([
                'post_type' => 'any',
                'posts_per_page' => -1,
                'post_status' => 'any',
                's' => basename($file_path)
            ]);

            foreach ($posts as $post) {
                $updated_content = str_replace(
                    basename($file_path),
                    basename($new_file_path),
                    $post->post_content
                );
                if ($updated_content !== $post->post_content) {
                    wp_update_post([
                        'ID' => $post->ID,
                        'post_content' => $updated_content
                    ]);
                }
            }

            $processed++;
        }
    }

    return $processed;
}

// Add to your cron jobs or run periodically
add_action('wp_scheduled_delete', 'confleko_cleanup_old_imports');

// Run monthly or as needed
if (!wp_next_scheduled('confleko_optimize_table')) {
    wp_schedule_event(time(), 'monthly', 'confleko_optimize_table');
}
add_action('confleko_optimize_table', 'confleko_optimize_import_table');
