<?php
// Security check.
if (!defined('ABSPATH')) {
    exit;
}

function confleko_add_settings_page()
{
    add_options_page(
        'Confleko Settings',
        'Confleko',
        'manage_options',
        'confleko-settings',
        'confleko_render_settings_page'
    );
}
add_action('admin_menu', 'confleko_add_settings_page');

function confleko_render_settings_page()
{
?>
    <div class="wrap">
        <h2>Confleko Settings</h2>
        <form action="options.php" method="post">
            <!-- Render settings here -->
            <input type="button" id="confleko-connect" value="Connect your website to Confleko" class="button button-primary">
        </form>
        <div id="confleko-response" style="margin-top: 20px;"></div>
    </div>
    <script type="text/javascript">
        jQuery(document).ready(function($) {
            $('#confleko-connect').click(function() {
                $.ajax({
                    url: ajaxurl,
                    method: 'POST',
                    data: {
                        action: 'generate_app_password_and_send',
                        // You can add a nonce here for additional security
                    },
                    success: function(response) {
                        if (response.success) {
                            var appPassword = response.data.app_password;
                            var responseHtml = '<p>App Password generated successfully!</p>' +
                                               '<button id="copy-app-password" class="button">Copy App Password</button>';
                            $('#confleko-response').html(responseHtml);
                            
                            $('#copy-app-password').click(function() {
                                var tempInput = $('<input>');
                                $('body').append(tempInput);
                                tempInput.val(appPassword).select();
                                document.execCommand('copy');
                                tempInput.remove();
                                $(this).text('Copied!');
                                setTimeout(function() {
                                    $('#copy-app-password').text('Copy App Password');
                                }, 2000);
                            });
                        } else {
                            $('#confleko-response').html('<p>Error: ' + response.data + '</p>');
                        }
                    },
                    error: function(error) {
                        console.error('Error:', error);
                        $('#confleko-response').html('<p>An error occurred. Please try again.</p>');
                    }
                });
            });
        });
    </script>

<?php
}

function generate_app_password_and_send()
{
    // Check user capabilities
    if (!current_user_can('edit_posts')) {
        wp_die('You do not have sufficient permissions to access this page.');
    }

    $user = wp_get_current_user();
    $username = $user->user_login;
    $domain = get_site_url();

    // Check if WP_Application_Passwords class exists
    if (class_exists('WP_Application_Passwords')) {
        // Generate App Password
        $app_password_name = 'confleko';
        $app_password_data = WP_Application_Passwords::create_new_application_password($user->ID, array('name' => $app_password_name));

        if (is_wp_error($app_password_data)) {
            wp_send_json_error($app_password_data->get_error_message());
            wp_die();
        }

        $app_password = $app_password_data[0]; // The first element is the new password
    } else {
        wp_send_json_error('Application passwords are not supported in this WordPress version.');
        wp_die();
    }

    // Prepare data for JSON return
    $data = array(
        'username' => $username,
        'app_password' => $app_password,
        'domain' => $domain,
    );

    // Return data as JSON
    wp_send_json_success($data);

    wp_die();
}
add_action('wp_ajax_generate_app_password_and_send', 'generate_app_password_and_send');
