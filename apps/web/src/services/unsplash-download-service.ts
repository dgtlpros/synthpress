import "server-only";

/**
 * Server-side Unsplash download-tracking helper.
 *
 * Why this exists:
 *   Unsplash's API guidelines require apps to fire a `GET` against
 *   the `links.download_location` URL whenever a photo is "actually
 *   downloaded / used" — NOT on every search-result render, only
 *   when the bytes leave Unsplash's CDN for our use. For SynthPress
 *   that moment is the WordPress media upload — we GET the
 *   `download_location` once, immediately after a successful WP
 *   upload, then never again for the cached `wp_media_id`.
 *
 * Why "best-effort":
 *   The publish service should NOT fail an article publish because
 *   Unsplash's tracking endpoint is slow/down. We surface success in
 *   the return value so the caller can opt to log, but never throw.
 *
 * Lives `server-only` so the `UNSPLASH_ACCESS_KEY` (the same key the
 * search helper uses) doesn't leak to the client. Doing the GET
 * server-side is also required by Unsplash — they reject anonymous
 * pings.
 */

export interface TriggerUnsplashDownloadInput {
  /** Unsplash's `links.download_location` URL. */
  downloadLocation: string | null | undefined;
  /** Inject a `fetch` for tests. Defaults to the global. */
  fetchImpl?: typeof fetch;
  /**
   * Inject the access key for tests. Defaults to reading
   * `process.env.UNSPLASH_ACCESS_KEY`.
   */
  accessKey?: string;
}

export interface TriggerUnsplashDownloadResult {
  /** True when a request was sent and Unsplash returned 2xx. */
  success: boolean;
  /**
   * Why we skipped or failed. `"sent"` for the success case so
   * structured logs / tests can distinguish "no-op" from "sent OK".
   */
  reason:
    | "sent"
    | "no_download_location"
    | "missing_access_key"
    | "request_failed"
    | "non_2xx";
}

/**
 * Fires the Unsplash download-tracking GET. Returns a structured
 * result instead of throwing — callers (the WP publish service) treat
 * a failure as a soft warning, not a publish blocker.
 */
export async function triggerUnsplashDownload(
  input: TriggerUnsplashDownloadInput,
): Promise<TriggerUnsplashDownloadResult> {
  if (!input.downloadLocation || !input.downloadLocation.trim()) {
    return { success: false, reason: "no_download_location" };
  }

  const accessKey = input.accessKey ?? process.env.UNSPLASH_ACCESS_KEY ?? "";
  if (!accessKey) {
    return { success: false, reason: "missing_access_key" };
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetchImpl(input.downloadLocation, {
      method: "GET",
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        Accept: "application/json",
      },
    });
  } catch {
    // Network errors are logged structurally via the result, never
    // thrown — the WP publish above us must not fail because of a
    // best-effort attribution ping.
    return { success: false, reason: "request_failed" };
  }

  if (!response.ok) {
    return { success: false, reason: "non_2xx" };
  }
  return { success: true, reason: "sent" };
}
