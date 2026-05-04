<?php
// Security check
if (!defined('ABSPATH')) {
    exit;
}

function confleko_create_import_table() {
    global $wpdb;
    $table_name = $wpdb->prefix . 'confleko_import_log';
    
    $charset_collate = $wpdb->get_charset_collate();

    $sql = "CREATE TABLE $table_name (
        id bigint(20) NOT NULL AUTO_INCREMENT,
        original_url varchar(2083) NOT NULL,
        new_url varchar(2083) NOT NULL,
        original_url_hash char(32) NOT NULL,
        import_date datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY original_url_hash (original_url_hash),
        KEY import_date (import_date)
    ) $charset_collate;";

    require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
    dbDelta($sql);
}

function confleko_add_import_log($original_url, $new_url) {
    global $wpdb;
    $table_name = $wpdb->prefix . 'confleko_import_log';

    // Create an MD5 hash of the original URL for faster lookups
    $url_hash = md5($original_url);

    // Use ON DUPLICATE KEY UPDATE to handle potential duplicates
    $result = $wpdb->query($wpdb->prepare(
        "INSERT INTO $table_name (original_url, new_url, original_url_hash)
        VALUES (%s, %s, %s)
        ON DUPLICATE KEY UPDATE
        new_url = VALUES(new_url),
        import_date = CURRENT_TIMESTAMP",
        $original_url,
        $new_url,
        $url_hash
    ));

    return $result !== false;
}

function confleko_get_import_log_by_url($url) {
    global $wpdb;
    $table_name = $wpdb->prefix . 'confleko_import_log';

    // First try to find by original URL hash for better performance
    $url_hash = md5($url);
    $result = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM $table_name WHERE original_url_hash = %s",
        $url_hash
    ));

    if (!$result) {
        // If not found by original URL, check if it matches a new URL
        $result = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table_name WHERE new_url = %s",
            $url
        ));
    }

    return $result;
}

// Add a cleanup function to remove old entries if needed
function confleko_cleanup_old_imports($days_to_keep = 90) {
    global $wpdb;
    $table_name = $wpdb->prefix . 'confleko_import_log';
    
    return $wpdb->query($wpdb->prepare(
        "DELETE FROM $table_name WHERE import_date < DATE_SUB(NOW(), INTERVAL %d DAY)",
        $days_to_keep
    ));
}

// Add an optimization function that can be run periodically
function confleko_optimize_import_table() {
    global $wpdb;
    $table_name = $wpdb->prefix . 'confleko_import_log';
    
    return $wpdb->query("OPTIMIZE TABLE $table_name");
}

// Add version control for database structure
function confleko_get_db_version() {
    return get_option('confleko_db_version', '1.0');
}

function confleko_update_db_version($version) {
    update_option('confleko_db_version', $version);
}

// Migration function
function confleko_migrate_database() {
    global $wpdb;
    $current_version = confleko_get_db_version();
    $table_name = $wpdb->prefix . 'confleko_import_log';

    // If we're already at the latest version, no need to migrate
    if (version_compare($current_version, '2.0', '>=')) {
        return;
    }

    // Check if the table exists
    $table_exists = $wpdb->get_var(
        $wpdb->prepare(
            "SELECT COUNT(1) FROM information_schema.tables WHERE table_schema = %s AND table_name = %s",
            DB_NAME,
            $table_name
        )
    );

    if (!$table_exists) {
        // If table doesn't exist, create it with the latest structure
        confleko_create_import_table();
        confleko_update_db_version('2.0');
        return;
    }

    // Start migration process
    $wpdb->query('START TRANSACTION');

    try {
        // Create temporary table with new structure
        $temp_table = $table_name . '_temp';
        $charset_collate = $wpdb->get_charset_collate();

        $wpdb->query("CREATE TABLE IF NOT EXISTS $temp_table (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            original_url varchar(2083) NOT NULL,
            new_url varchar(2083) NOT NULL,
            original_url_hash char(32) NOT NULL,
            import_date datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY original_url_hash (original_url_hash),
            KEY import_date (import_date)
        ) $charset_collate");

        // Copy existing data with URL hashing
        $wpdb->query("INSERT INTO $temp_table (original_url, new_url, original_url_hash, import_date)
            SELECT original_url, new_url, MD5(original_url), import_date 
            FROM $table_name");

        // Rename tables
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}_old");
        $wpdb->query("RENAME TABLE $table_name TO {$table_name}_old,
                                  $temp_table TO $table_name");

        // Commit transaction
        $wpdb->query('COMMIT');

        // Update version number
        confleko_update_db_version('2.0');

        // Cleanup old table after successful migration
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}_old");

        return true;
    } catch (Exception $e) {
        // If anything goes wrong, rollback
        $wpdb->query('ROLLBACK');
        error_log('Confleko database migration failed: ' . $e->getMessage());
        return false;
    }
}

// Register activation hook in the main plugin file
function confleko_check_db_upgrade() {
    $current_version = confleko_get_db_version();
    if (version_compare($current_version, '2.0', '<')) {
        confleko_migrate_database();
    }
}

// Add an admin notice if migration is needed
function confleko_admin_migration_notice() {
    $current_version = confleko_get_db_version();
    if (version_compare($current_version, '2.0', '<')) {
        ?>
        <div class="notice notice-warning is-dismissible">
            <p><?php _e('Confleko database needs to be upgraded. Please backup your database before proceeding.', 'confleko'); ?></p>
            <p>
                <a href="<?php echo wp_nonce_url(admin_url('admin-post.php?action=confleko_migrate_db'), 'confleko_migrate_db'); ?>" 
                   class="button button-primary">
                    <?php _e('Upgrade Database', 'confleko'); ?>
                </a>
            </p>
        </div>
        <?php
    }
}

// Handle the migration action
function confleko_handle_migration() {
    if (!current_user_can('manage_options')) {
        wp_die(__('You do not have sufficient permissions to perform this action.'));
    }

    check_admin_referer('confleko_migrate_db');

    if (confleko_migrate_database()) {
        wp_safe_redirect(add_query_arg('migration', 'success', wp_get_referer()));
    } else {
        wp_safe_redirect(add_query_arg('migration', 'error', wp_get_referer()));
    }
    exit;
}

// Add necessary action hooks
add_action('admin_notices', 'confleko_admin_migration_notice');
add_action('admin_post_confleko_migrate_db', 'confleko_handle_migration');
