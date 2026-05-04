<?php

namespace SynthPress\SyndicationService\Admin;

if (!defined('ABSPATH')) {
	exit; // Exit if accessed directly.
}

final class SettingsPage
{
	public function __construct()
	{
		add_action('admin_menu', array(self::class, 'register_settings_page'));
		add_action('admin_init', array(self::class, 'register_settings'));
		add_action('admin_init', array(self::class, 'register_section'));
	}

	public static function register_settings_page()
	{
		add_options_page('Syndication Tool Settings', 'Syndication Tool', 'manage_options', 'syndication_tool', array(static::class, 'render_page'));
	}

	public static function render_page()
	{
		if (! current_user_can('manage_options')) {
			return;
		}
?>
		<div class="wrap">
			<h1><?php echo esc_html(get_admin_page_title()); ?></h1>
			<form action="options.php" method="post">
				<?php
				settings_fields('syndication_tool_options');
				do_settings_sections('syndication_tool');
				submit_button(__('Save Settings', 'synthpress-syndication'));
				?>
			</form>
		</div>
	<?php
	}

	public static function register_settings()
	{
		register_setting('syndication_tool_options', 'syndication_tool_backlink_enable', array(
			'type' => 'boolean',
			'default' => false
		));

		register_setting('syndication_tool_options', 'syndication_tool_backlink_text', array(
			'type' => 'string',
			'default' => '<p>The post {{POST_LINK}} appeared first on {{SITE_LINK}}.</p>',
		));

		register_setting('syndication_tool_options', 'syndication_tool_ai_disclosure_enable', array(
			'type' => 'boolean',
			'default' => false
		));

		register_setting('syndication_tool_options', 'syndication_tool_ai_disclosure_text', array(
			'type' => 'string',
			'default' => "This content was created with the assistance of AI tools and thoroughly edited by a human"
		));
	}
	public static function register_section()
	{
		add_settings_section(
			'syndication_tool_defaults',
			'Defaults',
			array(static::class, 'render_defaults'),
			'syndication_tool'
		);

		add_settings_field(
			'syndication_tool_ai_disclosure',
			__('AI Disclosure', 'synthpress-syndication'),
			array(self::class, 'render_ai_disclosure_field'),
			'syndication_tool',
			'syndication_tool_defaults',
			array()
		);

		add_settings_field(
			'syndication_tool_backlink',
			__('Post Backlink', 'syndication_tool'),
			array(self::class, 'render_backlink_field'),
			'syndication_tool',
			'syndication_tool_defaults',
			array()
		);
	}

	public static function render_ai_disclosure_field($args)
	{
		$enable = get_option('syndication_tool_ai_disclosure_enable');
		$text = get_option('syndication_tool_ai_disclosure_text');
	?>
		<p>
			<input
				id="syndication_tool_ai_disclosure_enable"
				type="checkbox"
				name="syndication_tool_ai_disclosure_enable" value="1"
				<?php $enable === '1' && print('checked') ?> />
			<label for="syndication_tool_ai_disclosure_enable">
				Include AI Disclosure in footer of posts by default
			</label>
		</p>
		<fieldset style="margin-top: 12px">
			<p>
				<label class="widefat">
					<strong>Default Disclosure Text</strong>
				</label>
				<textarea
					class="large-text"
					name="syndication_tool_ai_disclosure_text"><?php echo wp_kses_post($text) ?></textarea>
			</p>
		</fieldset>
	<?php
	}

	public static function render_backlink_field($args)
	{
		$enable = get_option('syndication_tool_backlink_enable');
		$text = get_option('syndication_tool_backlink_text');
	?>
		<p>
			<input
				id="syndication_tool_backlink_enable"
				type="checkbox"
				name="syndication_tool_backlink_enable"
				value="1"
				<?php $enable === '1' && print('checked') ?> />
			<label for="syndication_tool_backlink_enable">
				Include backlink in footer of posts by default
			</label>
		</p>
		<fieldset style="margin-top: 12px">
			<p>
				<label for="syndication_tool_backlink_text" class="widefat">
					<strong>Canonical Link Text Template</strong>
				</label>
				<textarea
					class="large-text"
					name="syndication_tool_backlink_text"><?php echo wp_kses_post($text) ?></textarea>
			</p>
		</fieldset>
<?php
	}

	public static function render_defaults() {}
}
