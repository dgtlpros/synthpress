import type { PublishArticleErrorCode } from "@/services/wordpress-publish-service";

/**
 * UI copy for the WordPress publish flow's typed error codes.
 *
 * Lives in `src/lib/` (and NOT in `src/actions/articles.ts`)
 * because the actions file is `"use server"` — Next.js requires
 * such files to export only async functions, so a runtime const
 * (or any non-async export) breaks the dev build with
 * "A 'use server' file can only export async functions, found
 * object."
 *
 * Importing the type from `wordpress-publish-service` is safe —
 * a `import type` is erased at compile time, so this file does
 * NOT pull the server-only service into client bundles. The hook
 * (`useWordPressPublish`) imports this module directly to compare
 * the friendly remote-missing copy against the action's returned
 * error string.
 */
export const PUBLISH_ARTICLE_ERROR_COPY: Record<
  PublishArticleErrorCode,
  string
> = {
  article_not_found: "Article not found.",
  blog_not_found: "Blog not found.",
  no_wp_connection:
    "Connect a WordPress site first from the blog's Connections tab.",
  empty_article_body:
    "Add some Markdown content to the article before sending it to WordPress.",
  wp_post_id_required:
    "This article hasn't been sent to WordPress yet — send it as a draft first.",
  wp_post_not_found:
    "The WordPress post could not be found. It may have been deleted in WordPress. Clear the link and send again as a new draft.",
  wp_request_failed:
    "WordPress rejected the request. Check the connection and try again.",
  wp_invalid_response:
    "WordPress responded with an unexpected payload. Try again in a minute.",
};
