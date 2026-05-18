import "server-only";

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
 *   Action / WP code never imports `unsplashProvider` directly, so
 *   you can't accidentally couple them to Unsplash. They go
 *   through `getImageProvider(id)` and get back the
 *   `ImageSearchProvider` interface.
 *
 * Default provider:
 *   `'unsplash'` for now. The Unsplash picker is the only image-
 *   search UI in the app, so the default matches the picker. When
 *   we add a multi-provider picker, this constant becomes the
 *   "selected by default" tab/option.
 */

const PROVIDERS: Record<string, ImageSearchProvider> = {
  [unsplashProvider.providerId]: unsplashProvider,
};

export const DEFAULT_IMAGE_PROVIDER_ID: ImageProviderId =
  unsplashProvider.providerId;

/**
 * Returns the registered provider for `providerId` or throws an
 * `ImageSearchError("unsupported_provider")` so the action/UI can
 * map it to friendly copy through the standard error path.
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
 * Returns the list of registered provider ids. Useful for a future
 * multi-provider picker UI; today only Unsplash is registered.
 */
export function listImageProviderIds(): ImageProviderId[] {
  return Object.keys(PROVIDERS);
}
