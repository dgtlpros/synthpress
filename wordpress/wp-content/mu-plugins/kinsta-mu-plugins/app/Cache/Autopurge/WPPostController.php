<?php

namespace Kinsta\KMP\Cache\Autopurge;

use Kinsta\Cache_Purge;
use Kinsta\KMP;
use Kinsta\KMP\Cache\Autopurge;
use WP_Post;

use function Kinsta\KMP\debug_log;

/**
 * Handle cache purge when WordPress posts are updated.
 */
final class WPPostController extends Controller
{
	protected string $name = 'wp_post_controller';

	public function hook(): void
	{
        /**
         * @see kinsta-mu-plugins/cache/class-cache-purge.php
         * @todo Move all the "post" related hooks from `class-cache-purge.php` to this class.
         */
		add_action( 'save_post', array( $this, 'onSavePost' ), 10, 3 );
        add_action( 'transition_post_status', array( $this, 'onPostStatusChange' ), 10, 3 );
    }

    public function getDescription(): string
    {
        return __('Purge cache when posts are updated.', 'kinsta-mu-plugins');
    }

    public function onSavePost(int $postId, WP_Post $post, bool $update): void
    {
        if ( ! $this->shouldProceed() ) {
            return;
        }

		if ( $update === true && $this->isPostPublished( $postId ) ) {
			$this->kmp->kinsta_cache_purge->purge_single_happened = true;
			$this->kmp->kinsta_cache_purge->initiate_purge( $postId );

            debug_log(
                'Post cache clearing was initiated.',
                [
                    'controller' => __METHOD__,
                    'post_id' => $postId
                ]
            );
		}
    }

    public function onPostStatusChange( string $new_status, string $old_status, WP_Post $post ): void
    {
        // Do not proceed if the status is not changing.
        if ( ! $this->shouldProceed() || $new_status === $old_status ) {
            return;
        }

        // If post is published or was published before, we need to purge the cache.
		if ( $this->isPostPublished( $post->ID ) || $old_status === 'publish' ) {
			$this->kmp->kinsta_cache_purge->purge_single_happened = true;
			$this->kmp->kinsta_cache_purge->initiate_purge( $post->ID );

            debug_log(
                'Post cache clearing was initiated.',
                [
                    'controller' => __METHOD__,
                    'post_id' => $post->ID,
                    'post_status_new' => $new_status,
                    'post_status_old' => $old_status
                ]
            );
		}
    }

    private function isPostPublished(int $postId): bool
    {
        return ! wp_is_post_autosave( $postId ) && ! wp_is_post_revision( $postId ) && 'publish' === get_post_status( $postId );
    }
}
