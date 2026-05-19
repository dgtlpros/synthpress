import "server-only";

import { pexelsProvider } from "./pexels-provider";
import { unsplashProvider } from "./unsplash-provider";
import {
  ImageSearchError,
  type ImageProviderId,
  type ImageSearchProvider,
} from "./types";

/**
 * Image-provider registry.
 *
 * Single source of truth for "which providers does the app know
 * about, and which is the default". Every consumer (action, hook
 * indirectly, WordPress publish path) reads through here so adding
 * a new provider in a future PR is a one-line registration here +
 * a sibling adapter file.
 *
 * Why a registry over a switch:
 *   A registry keeps the provider list closed inside this file.
 *   Action / WP code never imports `pexelsProvider` /
 *   `unsplashProvider` directly, so you can't accidentally couple
 *   them to a single provider. They go through
 *   `getImageProvider(id)` and get back the `ImageSearchProvider`
 *   interface.
 *
 * Active vs. legacy:
 *   * **Active**: `pexels`. New picks (manual + autopilot) all go
 *     through here. {@link listImageProviderIds} returns only the
 *     active ids — UI selectors / settings dropdowns iterate this.
 *   * **Legacy**: `unsplash`. Still registered so historical
 *     `article_image_uploads` rows whose `provider='unsplash'` can
 *     still resolve via `getImageProvider('unsplash')` for the
 *     WordPress publish path's `trackDownload` ping. Not exposed
 *     in the dropdown / picker UI; existing rows continue to render
 *     attribution + publish to WordPress correctly.
 *
 * Default provider:
 *   `'pexels'` — what the picker + autopilot reach for when the
 *   blog's `settings.media.imageProvider` doesn't override.
 */

const ACTIVE_PROVIDERS: Record<string, ImageSearchProvider> = {
  [pexelsProvider.providerId]: pexelsProvider,
};

const LEGACY_PROVIDERS: Record<string, ImageSearchProvider> = {
  [unsplashProvider.providerId]: unsplashProvider,
};

const PROVIDERS: Record<string, ImageSearchProvider> = {
  ...LEGACY_PROVIDERS,
  ...ACTIVE_PROVIDERS,
};

export const DEFAULT_IMAGE_PROVIDER_ID: ImageProviderId =
  pexelsProvider.providerId;

/**
 * Returns the registered provider for `providerId` or throws an
 * `ImageSearchError("unsupported_provider")` so the action/UI can
 * map it to friendly copy through the standard error path.
 *
 * Resolves both active AND legacy providers — the WordPress publish
 * path needs to be able to look up a row's recorded provider even
 * when it's no longer offered to users (Unsplash today).
 *
 * Throws (rather than returning null) because every consumer needs
 * a provider to do anything useful. Hiding the failure behind a
 * null return would push the error handling into every call site;
 * the typed throw lets the existing `try/catch + ImageSearchError`
 * pattern in actions handle it for free.
 */
export function getImageProvider(
  providerId: ImageProviderId = DEFAULT_IMAGE_PROVIDER_ID,
): ImageSearchProvider {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new ImageSearchError("unsupported_provider", {
      providerId,
      details: providerId,
    });
  }
  return provider;
}

/**
 * Returns the list of **active** (user-facing) provider ids.
 * Settings dropdowns + future picker provider tabs iterate this.
 *
 * Legacy providers (Unsplash) are NOT included — they're resolvable
 * via {@link getImageProvider} for historical-row bookkeeping but
 * shouldn't appear in any selectable list.
 */
export function listImageProviderIds(): ImageProviderId[] {
  return Object.keys(ACTIVE_PROVIDERS);
}
