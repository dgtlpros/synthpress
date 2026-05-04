<?php
// Security check
if (!defined('ABSPATH')) {
    exit;
}

function confleko_add_import_log_menu() {
    add_submenu_page(
        'options-general.php',
        'Confleko Import Logs',
        'Import Logs',
        'manage_options',
        'confleko-import-logs',
        'confleko_import_log_page'
    );
}
add_action('admin_menu', 'confleko_add_import_log_menu');

function confleko_import_log_page() {
    global $wpdb;
    $table_name = $wpdb->prefix . 'confleko_import_log';

    // Add search functionality
    $search = isset($_GET['search']) ? sanitize_text_field($_GET['search']) : '';
    
    // Add pagination
    $per_page = 20;
    $current_page = isset($_GET['paged']) ? max(1, intval($_GET['paged'])) : 1;
    $offset = ($current_page - 1) * $per_page;

    // Build search query
    $where_clause = '';
    $search_params = [];
    if (!empty($search)) {
        $where_clause = "WHERE original_url LIKE %s 
                        OR new_url LIKE %s 
                        OR original_url_hash LIKE %s";
        $search_term = '%' . $wpdb->esc_like($search) . '%';
        $search_params = [$search_term, $search_term, $search_term];
    }

    // Get total count for pagination
    $total_items = $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM $table_name " . $where_clause,
        $search_params
    ));
    $total_pages = ceil($total_items / $per_page);

    // Get logs with pagination and search
    $query_params = array_merge($search_params, [$per_page, $offset]);
    $logs = $wpdb->get_results($wpdb->prepare(
        "SELECT * FROM $table_name " . 
        $where_clause . 
        " ORDER BY import_date DESC LIMIT %d OFFSET %d",
        $query_params
    ));

    // Get database version
    $db_version = confleko_get_db_version();

    ?>
    <div class="wrap">
        <h1>Confleko Import Logs</h1>
        <p>Database Version: <code><?php echo esc_html($db_version); ?></code></p>

        <!-- Search Form -->
        <div class="tablenav top">
            <div class="alignleft actions">
                <form method="get" action="">
                    <input type="hidden" name="page" value="confleko-import-logs">
                    <input type="search" 
                           name="search" 
                           value="<?php echo esc_attr($search); ?>" 
                           placeholder="Search URLs or Hash..."
                           style="padding: 4px 8px;">
                    <input type="submit" class="button" value="Search">
                    <?php if (!empty($search)): ?>
                        <a href="<?php echo esc_url(remove_query_arg('search')); ?>" class="button">Clear</a>
                    <?php endif; ?>
                </form>
            </div>
            <?php if (!empty($search)): ?>
                <div class="tablenav-pages one-page">
                    <span class="displaying-num">
                        Found: <?php echo number_format($total_items); ?> items
                    </span>
                </div>
            <?php endif; ?>
        </div>
        
        <?php if (empty($logs)): ?>
            <p><?php echo empty($search) ? 'No import logs found.' : 'No results found for: ' . esc_html($search); ?></p>
        <?php else: ?>
            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th style="width: 60px;">ID</th>
                        <th>Original URL</th>
                        <th>New URL</th>
                        <th>URL Hash</th>
                        <th>Import Date</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($logs as $log): ?>
                        <tr>
                            <td style="width: 60px;"><code>#<?php echo esc_html($log->id); ?></code></td>
                            <td>
                                <?php 
                                $truncated_orig = strlen($log->original_url) > 50 ? 
                                    substr($log->original_url, 0, 47) . '...' : 
                                    $log->original_url;
                                ?>
                                <span title="<?php echo esc_attr($log->original_url); ?>">
                                    <?php echo esc_html($truncated_orig); ?>
                                </span>
                            </td>
                            <td>
                                <?php 
                                $truncated_new = strlen($log->new_url) > 50 ? 
                                    substr($log->new_url, 0, 47) . '...' : 
                                    $log->new_url;
                                ?>
                                <span title="<?php echo esc_attr($log->new_url); ?>">
                                    <?php echo esc_html($truncated_new); ?>
                                </span>
                                <br>
                                <a href="<?php echo esc_url($log->new_url); ?>" target="_blank">View Image</a>
                            </td>
                            <td>
                                <code><?php echo esc_html($log->original_url_hash); ?></code>
                            </td>
                            <td><?php echo esc_html($log->import_date); ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>

            <?php if ($total_pages > 1): ?>
                <div class="tablenav bottom">
                    <div class="tablenav-pages">
                        <span class="pagination-links">
                            <?php
                            echo paginate_links(array(
                                'base' => add_query_arg('paged', '%#%'),
                                'format' => '',
                                'prev_text' => __('&laquo;'),
                                'next_text' => __('&raquo;'),
                                'total' => $total_pages,
                                'current' => $current_page,
                                'add_args' => array('search' => $search)
                            ));
                            ?>
                        </span>
                    </div>
                </div>
            <?php endif; ?>

            <script>
            jQuery(document).ready(function($) {
                // Add search highlight
                <?php if (!empty($search)): ?>
                var searchTerm = <?php echo json_encode($search); ?>;
                function highlightText(text) {
                    if (!searchTerm) return text;
                    var regex = new RegExp('(' + searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
                    return text.replace(regex, '<mark>$1</mark>');
                }
                
                $('td').each(function() {
                    var $td = $(this);
                    if (!$td.find('a').length) {
                        $td.html(highlightText($td.html()));
                    }
                });
                <?php endif; ?>
            });
            </script>
            <style>
            .wp-list-table td code {
                background: #f0f0f1;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 12px;
            }
            </style>
        <?php endif; ?>
    </div>
    <?php
}

// Add REST API endpoints
function confleko_register_rest_routes() {
    register_rest_route('confleko/v1', '/import-log', array(
        'methods' => 'POST',
        'callback' => 'confleko_add_import_log_api',
        'permission_callback' => function() {
            return current_user_can('edit_posts');
        }
    ));

    register_rest_route('confleko/v1', '/import-log/(?P<url>.*)', array(
        'methods' => 'GET',
        'callback' => 'confleko_get_import_log_api',
        'permission_callback' => function() {
            return current_user_can('edit_posts');
        }
    ));
}
add_action('rest_api_init', 'confleko_register_rest_routes');

function confleko_add_import_log_api($request) {
    $original_url = $request->get_param('original_url');
    $new_url = $request->get_param('new_url');

    if (empty($original_url) || empty($new_url)) {
        return new WP_Error('missing_params', 'Original URL and New URL are required', array('status' => 400));
    }

    $result = confleko_add_import_log($original_url, $new_url);

    if ($result) {
        return new WP_REST_Response(array('message' => 'Import log added successfully'), 201);
    } else {
        return new WP_Error('db_error', 'Could not add import log', array('status' => 500));
    }
}

function confleko_get_import_log_api($request) {
    $url = urldecode($request['url']);

    $log = confleko_get_import_log_by_url($url);

    if ($log) {
        return new WP_REST_Response($log, 200);
    } else {
        return new WP_Error('not_found', 'No import log found for the given URL', array('status' => 404));
    }
}
