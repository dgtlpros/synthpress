"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import {
  getImageProvider,
  DEFAULT_IMAGE_PROVIDER_ID,
} from "@/services/image-providers/registry";
import {
  ImageSearchError,
  type ImageProviderId,
  type ImageSearchResponse,
} from "@/services/image-providers/types";
import type { ActionResult } from "./workspace";
import { IMAGE_SEARCH_ERROR_COPY } from "@/lib/image-search-error-copy";

/**
 * Server action wrapping the image-provider registry's `searchImages`
 * for the "Pick from Unsplash" picker in the article editor.
 *
 * Routes through the provider abstraction (default: `'unsplash'`) so
 * a future multi-provider picker can pass a different `providerId`
 * without changing this surface.
 *
 * Permission model: `manage_blog`. The picker is reachable from the
 * same article-edit surface that uses `manage_blog` for save, so
 * gating the search behind the same role keeps the surface coherent
 * (no separate "search images" capability to maintain).
 *
 * Why we don't decrement Synth tokens here:
 *   Image search is free + doesn't consume LLM tokens. This is
 *   purely an editorial helper.
 */

export interface SearchUnsplashInput {
  /** Free-form search query. Trimmed; empty/whitespace is rejected. */
  query: string;
  /** 1-indexed page. Defaults to 1. */
  page?: number;
  /**
   * Image provider to search. Defaults to `'unsplash'`. Today the
   * registry only knows about Unsplash; future providers will slot
   * in via the registry without touching this signature.
   */
  providerId?: ImageProviderId;
}

export type SearchUnsplashResult = ImageSearchResponse;

export async function searchUnsplash(
  teamId: string,
  input: SearchUnsplashInput,
): Promise<ActionResult<SearchUnsplashResult>> {
  if (typeof input.query !== "string" || input.query.trim().length === 0) {
    return {
      data: null,
      error: IMAGE_SEARCH_ERROR_COPY.query_required,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { data: null, error: "You must be signed in." };
  }

  try {
    const admin = createAdminClient();
    await assertCan(teamId, user.id, "manage_blog", admin);

    const provider = getImageProvider(
      input.providerId ?? DEFAULT_IMAGE_PROVIDER_ID,
    );
    const result = await provider.searchImages({
      query: input.query,
      page: input.page,
    });
    return { data: result, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { data: null, error: err.code };
    }
    if (err instanceof ImageSearchError) {
      return {
        data: null,
        error: IMAGE_SEARCH_ERROR_COPY[err.code],
      };
    }
    const message =
      err instanceof Error ? err.message : "Image search failed.";
    return { data: null, error: message };
  }
}
