"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateArticle, type UpdateArticleResult } from "@/actions/articles";
import type { ArticleEditableFields } from "@/services/article-service";
import type {
  SectionImageDesiredState,
  SelectedImageMetadata,
} from "@/services/article-image-upload-service";

/**
 * Form value the edit UI mirrors. Same shape as the service input but
 * collapses optional nullable fields to plain strings — the form
 * always renders a controlled `<input>` / `<textarea>` and we convert
 * empty strings to null at the action boundary.
 */
export interface ArticleEditFormValue {
  title: string;
  slug: string;
  excerpt: string;
  metaDescription: string;
  targetKeyword: string;
  contentMarkdown: string;
  /** Featured image URL — empty string == "no image". */
  featuredImageUrl: string;
  /** Featured image alt text. */
  featuredImageAlt: string;
}

/**
 * Hand-off shape the picker / recently-used connectors use to update
 * URL + alt + provider attribution in one atomic call. Equivalent to
 * `SelectedImageMetadata` from the image-upload service plus the
 * resolved alt text the form should display (the connector picks the
 * right fallback before calling the hook).
 */
export interface FeaturedImageSelection {
  /** What gets stored in `articles.featured_image_url`. */
  imageUrl: string;
  /** What gets stored in `articles.featured_image_alt`. */
  altText: string;
  /** Provider attribution metadata to persist on save. */
  metadata: SelectedImageMetadata;
}

/**
 * In-progress section-image edit state, keyed by `section_key`. The
 * shape mirrors {@link SectionImageDesiredState} plus a `metadataDirty`
 * flag the hook uses to tell apart "user picked a fresh image"
 * (forward attribution) from "user only edited alt text on an
 * already-existing image" (preserve the existing row).
 *
 * The hook seeds this map from `initialSectionImages` so the editor
 * preloads what's already in `article_image_uploads`. Newly-picked
 * images go in with `metadataDirty: true`; alt-only edits flip the
 * URL's existing entry without touching the metadata.
 */
export interface SectionImageDraft {
  sectionKey: string;
  sectionHeading: string;
  sortOrder: number;
  imageUrl: string;
  altText: string;
  /**
   * Provider attribution from the picker. Null when the user is
   * editing alt text on a row that was loaded from the server (we
   * preserve the existing attribution columns on the server side
   * by passing `metadata: null` to the sync helper).
   */
  metadata: SelectedImageMetadata | null;
}

export type SectionImageDraftMap = Record<string, SectionImageDraft>;

/**
 * Initial section images supplied by the server (i.e. existing rows
 * in `article_image_uploads` with `role = 'section'`). The hook
 * shapes these into its in-memory draft map on mount + on
 * enterEdit / cancelEdit so the form preloads correctly.
 */
export interface InitialSectionImage {
  sectionKey: string;
  sectionHeading: string;
  sortOrder: number;
  imageUrl: string;
  altText: string | null;
}

export interface UseArticleEditOptions {
  teamId: string;
  projectId: string;
  blogId: string;
  articleId: string;
  initialValue: ArticleEditFormValue;
  /**
   * Existing section-image rows for the article (from
   * `article_image_uploads`). The hook keys them by `sectionKey`
   * for O(1) lookups while editing. Omit / pass `[]` when the
   * article has no section images yet.
   */
  initialSectionImages?: InitialSectionImage[];
  /** Fired with the new server-side status after a successful save. */
  onSaved?: (result: UpdateArticleResult) => void;
}

/**
 * The hand-off shape for picking a section image — same fields as
 * {@link FeaturedImageSelection} but addressed to a specific section
 * slot. The connector resolves the alt-text fallback before calling
 * the hook so the form/editor doesn't have to know about provider
 * specifics.
 */
export interface SectionImageSelection {
  sectionKey: string;
  sectionHeading: string;
  sortOrder: number;
  imageUrl: string;
  altText: string;
  metadata: SelectedImageMetadata;
}

export interface UseArticleEditResult {
  value: ArticleEditFormValue;
  setField: <K extends keyof ArticleEditFormValue>(
    key: K,
    value: ArticleEditFormValue[K],
  ) => void;
  /**
   * Atomic "user picked a featured image from the picker / recently-
   * used row" call. Sets URL + alt + provider attribution metadata
   * in one shot. The metadata is forwarded to the action on save —
   * but ONLY if the user hasn't manually edited the URL afterwards
   * (typing into `featuredImageUrl` clears the metadata, see
   * {@link setField}).
   */
  selectFeaturedImage: (selection: FeaturedImageSelection) => void;
  /**
   * Current section-image drafts keyed by `section_key`. The editor
   * looks up by section to render slot UI; the save path serializes
   * the map into a {@link SectionImageDesiredState}[] for the action.
   */
  sectionImages: SectionImageDraftMap;
  /**
   * Atomic "user picked an image for a specific section" call. If a
   * draft already exists for `sectionKey`, it's replaced (a fresh
   * pick overrides whatever was loaded from the server or picked
   * earlier in the same edit session).
   */
  selectSectionImage: (selection: SectionImageSelection) => void;
  /**
   * Update only the alt text on an existing section-image draft.
   * No-op if no draft exists for `sectionKey` — the form should
   * only render alt inputs for sections that have an image.
   */
  setSectionImageAlt: (sectionKey: string, altText: string) => void;
  /**
   * Drop the draft for `sectionKey`. On save, this DELETEs the
   * corresponding `article_image_uploads` row.
   */
  clearSectionImage: (sectionKey: string) => void;
  isEditing: boolean;
  enterEdit: () => void;
  cancelEdit: () => void;
  save: () => void;
  isSaving: boolean;
  saveError: string | null;
  resetSaveError: () => void;
}

/**
 * Build the {@link SectionImageDesiredState}[] payload from the
 * hook's draft map. Skips drafts whose `imageUrl` collapses to
 * empty (defensive — `clearSectionImage` already deletes those
 * entries, but a future "alt-only" draft without an image would
 * also be filtered here).
 */
function toSectionImagesPayload(
  drafts: SectionImageDraftMap,
): SectionImageDesiredState[] {
  const out: SectionImageDesiredState[] = [];
  for (const draft of Object.values(drafts)) {
    const url = draft.imageUrl.trim();
    if (!url) continue;
    const alt = draft.altText.trim();
    out.push({
      sectionKey: draft.sectionKey,
      sectionHeading: draft.sectionHeading,
      sortOrder: draft.sortOrder,
      imageUrl: url,
      altText: alt || null,
      metadata: draft.metadata,
    });
  }
  return out;
}

function toFields(
  value: ArticleEditFormValue,
  selectedImageMetadata: SelectedImageMetadata | null,
  sectionImages: SectionImageDraftMap | null,
): ArticleEditableFields {
  // Collapse blanks → null at the boundary so the DB sees a clean
  // distinction between "user cleared this field" and "this field never
  // had a value".
  const trim = (s: string) => s.trim();
  return {
    title: value.title,
    slug: trim(value.slug) || null,
    excerpt: trim(value.excerpt) || null,
    metaDescription: trim(value.metaDescription) || null,
    targetKeyword: trim(value.targetKeyword) || null,
    contentMarkdown: trim(value.contentMarkdown) || null,
    featuredImageUrl: trim(value.featuredImageUrl) || null,
    featuredImageAlt: trim(value.featuredImageAlt) || null,
    selectedImageMetadata,
    // `sectionImages: undefined` tells the server "don't touch
    // section rows" (legacy callers). The connector always passes
    // an object here once the user opens the editor — empty map
    // becomes empty array, which DELETEs any existing section rows
    // not covered by the current edit. That's the right semantics:
    // if the editor's section-images card was visible but empty,
    // the user intends "no section images on this article".
    sectionImages:
      sectionImages !== null
        ? toSectionImagesPayload(sectionImages)
        : undefined,
  };
}

/**
 * Convert the server-loaded section-image rows into the hook's
 * `SectionImageDraftMap`. Server fields use snake_case + nullable
 * alt_text; the form expects a plain `altText: string` so empty alt
 * collapses to "" for the controlled input.
 */
function seedSectionImageDrafts(
  initial: InitialSectionImage[] | undefined,
): SectionImageDraftMap {
  if (!initial || initial.length === 0) return {};
  const map: SectionImageDraftMap = {};
  for (const row of initial) {
    map[row.sectionKey] = {
      sectionKey: row.sectionKey,
      sectionHeading: row.sectionHeading,
      sortOrder: row.sortOrder,
      imageUrl: row.imageUrl,
      altText: row.altText ?? "",
      // No metadata for server-loaded rows — the server-side sync
      // helper handles "row exists, same URL → preserve attribution"
      // when `metadata` is null.
      metadata: null,
    };
  }
  return map;
}

/**
 * Controller hook for the article detail page's edit mode.
 *
 * Owns:
 *   * `isEditing` — toggles between read view + edit form
 *   * the form `value` (controlled inputs)
 *   * pending + error state for the save server action
 *   * `pendingImageMetadata` — provider attribution captured when
 *     the user picks from the Unsplash / recently-used pickers,
 *     forwarded to the action on save. Cleared when the user edits
 *     the URL by hand or cancels.
 *
 * Resets the form `value` to `initialValue` on cancel — important so
 * a "click Edit, type stuff, hit Cancel, click Edit again" cycle
 * starts from the canonical server state, not the user's last typing.
 */
export function useArticleEdit({
  teamId,
  projectId,
  blogId,
  articleId,
  initialValue,
  initialSectionImages,
  onSaved,
}: UseArticleEditOptions): UseArticleEditResult {
  const router = useRouter();
  const [, startSave] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [value, setValue] = useState<ArticleEditFormValue>(initialValue);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingImageMetadata, setPendingImageMetadata] =
    useState<SelectedImageMetadata | null>(null);
  const [sectionImages, setSectionImages] = useState<SectionImageDraftMap>(() =>
    seedSectionImageDrafts(initialSectionImages),
  );
  // Tracks whether the consumer opted into the section-image
  // surface. When `false` (legacy callers without
  // `initialSectionImages`), the save payload omits `sectionImages`
  // so the server keeps the old "don't touch section rows"
  // semantics. When `true` (connector with section UI), even an
  // empty map sends `[]` — meaning "delete every existing section
  // row", which is the right semantics for "the user cleared all
  // section images".
  const sectionImagesEnabled = initialSectionImages !== undefined;

  const setField = useCallback(
    <K extends keyof ArticleEditFormValue>(
      key: K,
      next: ArticleEditFormValue[K],
    ) => {
      setValue((prev) => ({ ...prev, [key]: next }));
      // Auto-clear the pending Unsplash/recently-used metadata when
      // the user manually edits the URL — typing breaks the link
      // between the picked photo and the URL we'll save, so the
      // attribution row would be inaccurate. The clear runs lazily
      // via setPendingImageMetadata(prev => …) so we can compare
      // against the *latest* metadata without taking it as a
      // dependency.
      if (key === "featuredImageUrl") {
        setPendingImageMetadata((prevMeta) =>
          prevMeta && prevMeta.imageUrl === next ? prevMeta : null,
        );
      }
    },
    [],
  );

  const selectFeaturedImage = useCallback(
    (selection: FeaturedImageSelection) => {
      setValue((prev) => ({
        ...prev,
        featuredImageUrl: selection.imageUrl,
        featuredImageAlt: selection.altText,
      }));
      setPendingImageMetadata(selection.metadata);
    },
    [],
  );

  const selectSectionImage = useCallback((selection: SectionImageSelection) => {
    setSectionImages((prev) => ({
      ...prev,
      [selection.sectionKey]: {
        sectionKey: selection.sectionKey,
        sectionHeading: selection.sectionHeading,
        sortOrder: selection.sortOrder,
        imageUrl: selection.imageUrl,
        altText: selection.altText,
        // Fresh provider attribution — the save path forwards
        // this to `recordArticleImageUpload` so the new
        // `article_image_uploads` row carries the full credit.
        metadata: selection.metadata,
      },
    }));
  }, []);

  const setSectionImageAlt = useCallback(
    (sectionKey: string, altText: string) => {
      setSectionImages((prev) => {
        const existing = prev[sectionKey];
        if (!existing) return prev;
        return { ...prev, [sectionKey]: { ...existing, altText } };
      });
    },
    [],
  );

  const clearSectionImage = useCallback((sectionKey: string) => {
    setSectionImages((prev) => {
      if (!(sectionKey in prev)) return prev;
      const next = { ...prev };
      delete next[sectionKey];
      return next;
    });
  }, []);

  const enterEdit = useCallback(() => {
    setSaveError(null);
    setValue(initialValue);
    setPendingImageMetadata(null);
    // Re-seed section drafts from server state so a "type, cancel,
    // edit again" cycle returns to the canonical server values.
    setSectionImages(seedSectionImageDrafts(initialSectionImages));
    setIsEditing(true);
  }, [initialValue, initialSectionImages]);

  const cancelEdit = useCallback(() => {
    setSaveError(null);
    setValue(initialValue);
    setPendingImageMetadata(null);
    setSectionImages(seedSectionImageDrafts(initialSectionImages));
    setIsEditing(false);
  }, [initialValue, initialSectionImages]);

  const save = useCallback(() => {
    setSaveError(null);
    setIsSaving(true);
    startSave(async () => {
      const result = await updateArticle(
        teamId,
        projectId,
        blogId,
        articleId,
        toFields(
          value,
          pendingImageMetadata,
          sectionImagesEnabled ? sectionImages : null,
        ),
      );
      if (result.error !== null) {
        setSaveError(result.error);
        setIsSaving(false);
        return;
      }
      // Drop the pending metadata so a later save (without a fresh
      // pick) doesn't accidentally re-insert the same attribution row.
      // Section-image drafts intentionally stay as-is — on the next
      // edit-mode entry they re-seed from `initialSectionImages`
      // (which the server-component refresh has freshly updated).
      setPendingImageMetadata(null);
      router.refresh();
      setIsEditing(false);
      setIsSaving(false);
      onSaved?.(result.data);
    });
  }, [
    router,
    teamId,
    projectId,
    blogId,
    articleId,
    value,
    pendingImageMetadata,
    sectionImages,
    sectionImagesEnabled,
    onSaved,
  ]);

  const resetSaveError = useCallback(() => setSaveError(null), []);

  return {
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
    resetSaveError,
  };
}
