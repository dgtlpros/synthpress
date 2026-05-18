"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import { listRecentImageUploadsForBlog } from "@/services/article-image-upload-service";
import type { ActionResult } from "./workspace";

/**
 * Server actions for `article_image_uploads` (the per-article image
 * provenance table). Today: a single read action that powers the
 * "Recently used" section of the Unsplash picker.
 *
 * Why a separate file from `unsplash.ts`:
 *   The recents list is provider-agnostic — it returns rows for any
 *   image previously stamped on this blog (Unsplash today; future
 *   AI-gen / manual flows tomorrow). Keeping it out of `unsplash.ts`
 *   means we don't have to rename when the second provider lands.
 */

/**
 * Client-safe slice of an `article_image_uploads` row. Mirrors the
 * picker's needs: a thumbnail / URL to set as `featured_image_url`,
 * alt text to copy, attribution to show, and (importantly) the
 * cached `wp_media_id` so the editor can reuse a previous upload
 * without forcing the publish service to re-push the bytes.
 */
export interface RecentImageUpload {
  /** Attribution-row id; the picker uses it as a React key. */
  id: string;
  imageUrl: string;
  altText: string | null;
  provider: string;
  providerPhotoId: string | null;
  photographerName: string | null;
  photographerProfileUrl: string | null;
  photoUrl: string | null;
  downloadLocation: string | null;
  wpMediaId: number | null;
}

/**
 * Returns the most recent image uploads for a blog, deduped by
 * `imageUrl`. Used by the Unsplash picker's "Recently used" section.
 *
 * Auth + permission model:
 *   * Auth required (sign-in check).
 *   * `manage_blog` because the picker is reachable from the article
 *     edit surface that already requires the same role.
 *
 * Default limit is 12 (matches the picker grid size). The action
 * doesn't expose pagination — keep the surface narrow until product
 * needs it.
 */
export async function getRecentBlogImageUploads(
  teamId: string,
  blogId: string,
): Promise<ActionResult<RecentImageUpload[]>> {
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

    const rows = await listRecentImageUploadsForBlog(blogId, { client: admin });
    const data: RecentImageUpload[] = rows.map((row) => ({
      id: row.id,
      imageUrl: row.image_url,
      altText: row.alt_text,
      provider: row.provider,
      providerPhotoId: row.provider_photo_id,
      photographerName: row.photographer_name,
      photographerProfileUrl: row.photographer_profile_url,
      photoUrl: row.photo_url,
      downloadLocation: row.download_location,
      wpMediaId: row.wp_media_id,
    }));
    return { data, error: null };
  } catch (err) {
    if (err instanceof TeamPermissionError) {
      return { data: null, error: err.code };
    }
    /* v8 ignore next 4 -- defensive: assertCan + the service helper cover the typed paths above; this fallthrough surfaces any unexpected infra failure as a friendly string. */
    const message =
      err instanceof Error ? err.message : "Could not load recent images.";
    return { data: null, error: message };
  }
}
