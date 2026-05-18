import type { ImageSearchErrorCode } from "@/services/image-providers/types";

/**
 * UI copy for image-search typed error codes (provider-agnostic).
 *
 * Lives in `src/lib/` (and NOT `src/actions/unsplash.ts`) because the
 * actions file is `"use server"` — Next.js requires such files to
 * export only async functions, so a runtime const there would break
 * the dev build with "A 'use server' file can only export async
 * functions, found object."
 *
 * Importing the type from `image-providers/types` is safe — that
 * module is type-only at the import boundary (and importing only
 * `ImageSearchErrorCode` doesn't drag the `server-only` provider
 * implementations into client bundles). The picker hook imports
 * this module directly to compare friendly copy against the
 * action's returned error string.
 *
 * Note: copy is currently Unsplash-leaning because Unsplash is the
 * only registered provider. When we add a second provider, swap to
 * a `(providerDisplayName) => string` factory so the messages can
 * say "Pexels rate limit reached" etc.
 */
export const IMAGE_SEARCH_ERROR_COPY: Record<ImageSearchErrorCode, string> = {
  query_required: "Type something to search images.",
  missing_access_key:
    "Image search is not configured. Add UNSPLASH_ACCESS_KEY to your environment to enable image search.",
  rate_limited: "Image search rate limit reached. Wait a minute and try again.",
  request_failed:
    "Couldn't reach the image provider. Check your connection and try again.",
  invalid_response:
    "Image provider responded with an unexpected payload. Try again in a minute.",
  unsupported_provider:
    "That image provider isn't available. Try a different source.",
};
