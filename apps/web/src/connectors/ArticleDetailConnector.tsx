"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type RecentImageUpload,
  getRecentBlogImageUploads,
} from "@/actions/article-images";
import {
  ArticleDetail,
  type ArticleDetailData,
} from "@/components/organisms/ArticleDetail";
import { ArticleEditForm } from "@/components/organisms/ArticleEditForm";
import { UnsplashPicker } from "@/components/molecules/UnsplashPicker";
import {
  type ArticleEditFormValue,
  type InitialSectionImage,
  useArticleEdit,
} from "@/hooks/useArticleEdit";
import { useUnsplashSearch } from "@/hooks/useUnsplashSearch";
import type { NormalizedImageSearchResult } from "@/services/image-providers/types";
import type { ExtractedArticleSection } from "@/lib/extract-article-sections";
import { ArticleWordPressPublishConnector } from "./ArticleWordPressPublishConnector";

/**
 * Discriminator for which surface the picker is currently feeding.
 * Carries the slot context for section picks so the connector can
 * stamp `sectionKey` / `sectionHeading` / `sortOrder` onto the
 * selection without a second lookup.
 */
type PickerTarget =
  | { kind: "featured" }
  | {
      kind: "section";
      sectionKey: string;
      sectionHeading: string;
      sortOrder: number;
    };

export interface ArticleDetailConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  article: ArticleDetailData;
  /**
   * Existing section-image rows loaded server-side. Forwarded to
   * `useArticleEdit` to seed the section-image draft map AND used
   * by the read view (via `article.sectionImagesByKey`). Passing
   * `undefined` keeps the legacy "no section-image surface"
   * behavior — the connector only renders the section editor when
   * an array is supplied.
   */
  initialSectionImages?: InitialSectionImage[];
  /**
   * True iff the blog has all three WordPress credential fields
   * stored. Computed in the parent server component so we don't
   * re-query Supabase from the client.
   */
  hasWordPressConnection: boolean;
  /**
   * Where the publish card's "Connect WordPress" link points —
   * typically `${blogBase}/connections`.
   */
  connectionsHref: string;
}

/**
 * Bridges the read-view + edit-form organisms with the
 * {@link useArticleEdit} hook. Read mode shows {@link ArticleDetail}
 * with an Edit button; edit mode shows {@link ArticleEditForm} with
 * Save / Cancel.
 *
 * The page (server component) hands us the article in `ArticleDetailData`
 * shape; we derive the editor's initial form value from the same
 * source so a Cancel always returns to the canonical server state.
 *
 * Below the read view we also mount the WordPress publish card. We
 * deliberately do NOT render the publish card while the user is
 * actively editing — the card mutates the same article row through
 * a different action and the UX is cleaner if "Send to WordPress"
 * is only available on the saved version.
 */
export function ArticleDetailConnector({
  teamId,
  projectId,
  blogId,
  article,
  initialSectionImages,
  hasWordPressConnection,
  connectionsHref,
}: ArticleDetailConnectorProps) {
  const initialValue: ArticleEditFormValue = {
    title: article.title,
    slug: article.slug ?? "",
    excerpt: article.excerpt ?? "",
    metaDescription: article.metaDescription ?? "",
    targetKeyword: article.targetKeyword ?? "",
    contentMarkdown: article.contentMarkdown ?? "",
    featuredImageUrl: article.featuredImageUrl ?? "",
    featuredImageAlt: article.featuredImageAlt ?? "",
  };

  const {
    value,
    setField,
    selectFeaturedImage,
    sectionImages,
    selectSectionImage,
    setSectionImageAlt,
    clearSectionImage,
    isEditing,
    enterEdit,
    cancelEdit,
    save,
    isSaving,
    saveError,
  } = useArticleEdit({
    teamId,
    projectId,
    blogId,
    articleId: article.id,
    initialValue,
    initialSectionImages,
  });

  // Unsplash picker state. Lives at the connector layer so the picker
  // can update the form `value` (via `setField`) without making the
  // edit form aware of search/network plumbing.
  //
  // `pickerTarget` is the discriminator: when the user clicks a
  // featured-image picker we set `{kind: 'featured'}`; when they
  // click a section slot we set `{kind: 'section', sectionKey, …}`.
  // The same modal + the same `useUnsplashSearch` hook serve both —
  // `handleSelectFromPicker` branches on the target on submit.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [recentUploads, setRecentUploads] = useState<RecentImageUpload[]>([]);
  // Featured-image picker default search: target keyword > title >
  // "". Section picker default = the section heading text. Resolved
  // when the picker opens via `handlePickFromUnsplash` /
  // `handlePickSectionImage` so the same `useUnsplashSearch` hook
  // can be reused.
  const featuredInitialQuery = (
    article.targetKeyword ||
    article.title ||
    ""
  ).trim();
  const unsplash = useUnsplashSearch({
    teamId,
    initialQuery: featuredInitialQuery,
  });

  // Lazy-load the "Recently used" list when the picker opens. We
  // re-fetch each open instead of caching, so a new article-save in
  // another tab is reflected the next time the picker comes back.
  // Failures are swallowed — the picker still works without a
  // recents section.
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    void (async () => {
      const result = await getRecentBlogImageUploads(teamId, blogId);
      // Cancel guard: skip the state update if the picker (or whole
      // page) unmounted while the fetch was in flight. v8-ignored
      // because exercising it would require a fragile unmount-mid-
      // promise pattern that adds complexity without exercising
      // real behavior.
      /* v8 ignore next 1 */
      if (cancelled) return;
      if (result.error !== null) return;
      setRecentUploads(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, teamId, blogId]);

  const handlePickFromUnsplash = useCallback(() => {
    // Re-prefill the query each time the picker opens so a previous
    // search session doesn't bleed into a fresh one. We don't auto-
    // search on open — the user might want to refine the query first.
    unsplash.setQuery(featuredInitialQuery);
    unsplash.resetError();
    setPickerTarget({ kind: "featured" });
    setPickerOpen(true);
  }, [unsplash, featuredInitialQuery]);

  const handlePickSectionImage = useCallback(
    (section: ExtractedArticleSection) => {
      // Default the section picker's search query to the heading
      // text — section images are tied to a single heading so the
      // heading is the best search seed (better than re-using the
      // article-wide target keyword).
      unsplash.setQuery(section.sectionHeading);
      unsplash.resetError();
      setPickerTarget({
        kind: "section",
        sectionKey: section.sectionKey,
        sectionHeading: section.sectionHeading,
        sortOrder: section.sortOrder,
      });
      setPickerOpen(true);
    },
    [unsplash],
  );

  /**
   * Builds the SelectedImageMetadata payload shared by the
   * featured + section pick handlers. Same provider fields for both
   * surfaces — only the role + section-slot bits differ.
   */
  const handleSelectFromPicker = useCallback(
    (photo: NormalizedImageSearchResult) => {
      /* v8 ignore next 1 -- defensive guard against a stale picker selection arriving after onClose nulled the target; in normal use the picker is unmounted before this can fire */
      if (!pickerTarget) return;

      if (pickerTarget.kind === "featured") {
        // Alt fallback chain: provider's altDescription → description
        // → "Photo for <article title>" → empty. Mirrors the v3
        // featured-image selection logic.
        const altFallback = (article.title || "").trim();
        const altText =
          photo.altDescription ||
          photo.description ||
          (altFallback ? `Photo for "${altFallback}"` : "");
        selectFeaturedImage({
          imageUrl: photo.regularUrl,
          altText,
          metadata: {
            provider: photo.provider,
            providerPhotoId: photo.providerPhotoId,
            imageUrl: photo.regularUrl,
            altText: altText || null,
            photographerName: photo.photographerName ?? null,
            photographerProfileUrl: photo.photographerProfileUrl ?? null,
            photoUrl: photo.photoUrl ?? null,
            downloadLocation: photo.downloadLocation ?? null,
            wpMediaId: null,
          },
        });
      } else {
        // Section pick — alt fallback chain prefers the section
        // heading (more specific than the article title for a
        // per-section image).
        const altFallback = pickerTarget.sectionHeading.trim();
        const altText =
          photo.altDescription ||
          photo.description ||
          (altFallback ? `Image for "${altFallback}"` : "");
        selectSectionImage({
          sectionKey: pickerTarget.sectionKey,
          sectionHeading: pickerTarget.sectionHeading,
          sortOrder: pickerTarget.sortOrder,
          imageUrl: photo.regularUrl,
          altText,
          metadata: {
            provider: photo.provider,
            providerPhotoId: photo.providerPhotoId,
            imageUrl: photo.regularUrl,
            altText: altText || null,
            photographerName: photo.photographerName ?? null,
            photographerProfileUrl: photo.photographerProfileUrl ?? null,
            photoUrl: photo.photoUrl ?? null,
            downloadLocation: photo.downloadLocation ?? null,
            wpMediaId: null,
            role: "section",
            sectionKey: pickerTarget.sectionKey,
            sectionHeading: pickerTarget.sectionHeading,
            sortOrder: pickerTarget.sortOrder,
          },
        });
      }
      setPickerOpen(false);
      setPickerTarget(null);
    },
    [pickerTarget, article.title, selectFeaturedImage, selectSectionImage],
  );

  const handleSelectRecentUpload = useCallback(
    (upload: RecentImageUpload) => {
      /* v8 ignore next 1 -- defensive guard against a stale recents selection arriving after onClose nulled the target; in normal use the picker is unmounted before this can fire */
      if (!pickerTarget) return;
      if (pickerTarget.kind === "featured") {
        // The recents row already has alt text from when it was
        // first saved — reuse it verbatim.
        const altText = upload.altText ?? "";
        selectFeaturedImage({
          imageUrl: upload.imageUrl,
          altText,
          metadata: {
            provider: upload.provider,
            providerPhotoId: upload.providerPhotoId,
            imageUrl: upload.imageUrl,
            altText: upload.altText,
            photographerName: upload.photographerName,
            photographerProfileUrl: upload.photographerProfileUrl,
            photoUrl: upload.photoUrl,
            downloadLocation: upload.downloadLocation,
            // The recents row's `wpMediaId` is forwarded so the
            // editor can short-circuit the WordPress upload step on
            // the next sync (the publish service skips the upload
            // + uses this id directly when present).
            wpMediaId: upload.wpMediaId,
          },
        });
      } else {
        const altText = upload.altText ?? "";
        selectSectionImage({
          sectionKey: pickerTarget.sectionKey,
          sectionHeading: pickerTarget.sectionHeading,
          sortOrder: pickerTarget.sortOrder,
          imageUrl: upload.imageUrl,
          altText,
          metadata: {
            provider: upload.provider,
            providerPhotoId: upload.providerPhotoId,
            imageUrl: upload.imageUrl,
            altText: upload.altText,
            photographerName: upload.photographerName,
            photographerProfileUrl: upload.photographerProfileUrl,
            photoUrl: upload.photoUrl,
            downloadLocation: upload.downloadLocation,
            wpMediaId: upload.wpMediaId,
            role: "section",
            sectionKey: pickerTarget.sectionKey,
            sectionHeading: pickerTarget.sectionHeading,
            sortOrder: pickerTarget.sortOrder,
          },
        });
      }
      setPickerOpen(false);
      setPickerTarget(null);
    },
    [pickerTarget, selectFeaturedImage, selectSectionImage],
  );

  // Project the controller's draft map into the form's `{ imageUrl,
  // altText }` slot shape. Done here (not in the hook) so the hook
  // keeps the richer attribution metadata for the save path and the
  // form stays a dumb {url, alt} consumer.
  const sectionImagesForForm = Object.fromEntries(
    Object.entries(sectionImages).map(([k, v]) => [
      k,
      { imageUrl: v.imageUrl, altText: v.altText },
    ]),
  );

  // Only render the editor's section-image card when the parent
  // wired in `initialSectionImages` — preserves legacy "no section
  // surface" behavior for callers that don't pass it.
  const sectionsEnabled = initialSectionImages !== undefined;

  const handleClosePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerTarget(null);
  }, []);

  if (isEditing) {
    return (
      <>
        <ArticleEditForm
          value={value}
          onChange={setField}
          onCancel={cancelEdit}
          onSubmit={save}
          isSaving={isSaving}
          errorMessage={saveError}
          onPickFromUnsplash={handlePickFromUnsplash}
          sectionImages={sectionsEnabled ? sectionImagesForForm : undefined}
          onPickSectionImage={
            sectionsEnabled ? handlePickSectionImage : undefined
          }
          onSectionImageAltChange={
            sectionsEnabled ? setSectionImageAlt : undefined
          }
          onClearSectionImage={sectionsEnabled ? clearSectionImage : undefined}
        />
        <UnsplashPicker
          open={pickerOpen}
          onClose={handleClosePicker}
          query={unsplash.query}
          onQueryChange={unsplash.setQuery}
          onSearch={unsplash.search}
          onSelect={handleSelectFromPicker}
          results={unsplash.results}
          totalResults={unsplash.totalResults}
          isSearching={unsplash.isSearching}
          errorMessage={unsplash.error}
          hasSearched={unsplash.hasSearched}
          recentUploads={recentUploads}
          onSelectRecent={handleSelectRecentUpload}
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      <ArticleDetail article={article} onEdit={enterEdit} />
      <ArticleWordPressPublishConnector
        teamId={teamId}
        projectId={projectId}
        blogId={blogId}
        articleId={article.id}
        hasWordPressConnection={hasWordPressConnection}
        hasBody={Boolean(
          article.contentMarkdown && article.contentMarkdown.trim(),
        )}
        wpPostId={article.wpPostId}
        wpPostUrl={article.wpPostUrl}
        articleStatus={article.status}
        featuredImageUrl={article.featuredImageUrl}
        wpFeaturedMediaId={article.wpFeaturedMediaId}
        connectionsHref={connectionsHref}
      />
    </div>
  );
}
