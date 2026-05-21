<?php
/**
 * Prevent Author-role users from accessing wp-admin unless explicitly
 * allowed via a per-user checkbox. SynthPress publishing uses an Editor
 * bot (e.g. synthpress-bot) via Application Passwords — REST is unaffected.
 */
if (!defined('ABSPATH')) exit;

add_action('show_user_profile', 'add_allowed_author_checkbox');
add_action('edit_user_profile', 'add_allowed_author_checkbox');

function add_allowed_author_checkbox($user) {
    if (current_user_can('administrator') && in_array('author', $user->roles)) {
        ?>
        <h3>Login Access Control</h3>
        <table class="form-table">
            <tr>
                <th><label for="allow_author_login">Allow login</label></th>
                <td>
                    <input type="checkbox" name="allow_author_login" id="allow_author_login" value="yes"
                    <?php checked(get_user_meta($user->ID, 'allow_author_login', true), 'yes'); ?> />
                    <span class="description">Check this box to allow the author to log in to wp-admin.</span>
                </td>
            </tr>
        </table>
        <?php
    }
}

add_action('personal_options_update', 'save_allowed_author_checkbox');
add_action('edit_user_profile_update', 'save_allowed_author_checkbox');

function save_allowed_author_checkbox($user_id) {
    if (current_user_can('administrator')) {
        $user = get_userdata($user_id);
        if (in_array('author', $user->roles)) {
            if (isset($_POST['allow_author_login']) && $_POST['allow_author_login'] === 'yes') {
                update_user_meta($user_id, 'allow_author_login', 'yes');
            } else {
                delete_user_meta($user_id, 'allow_author_login');
            }
        }
    }
}

add_action('wp_login', 'restrict_author_login_on_login', 10, 2);

function restrict_author_login_on_login($user_login, $user) {
    if (isset($user->roles) && is_array($user->roles) && in_array('author', $user->roles) && get_user_meta($user->ID, 'allow_author_login', true) !== 'yes') {
        wp_logout();
        wp_redirect(home_url());
        exit;
    }
}
