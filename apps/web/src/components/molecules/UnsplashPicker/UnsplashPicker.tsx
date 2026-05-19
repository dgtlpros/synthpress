"use client";

import type { RecentImageUpload } from "@/actions/article-images";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { Label } from "@/components/atoms/Label";
import { Modal } from "@/components/atoms/Modal";
import { Spinner } from "@/components/atoms/Spinner";
import { cn } from "@/lib/cn";
import { providerDisplayLabel } from "@/lib/image-provider-label";
import type { NormalizedImageSearchResult } from "@/services/image-providers/types";

/**
 * Modal that lets the user search the active image provider and
 * pick a featured / section image for the article they're editing.
 * Pure presentational — the parent connector wires up state via
 * `useUnsplashSearch` (the hook name is internal-historical; it
 * routes through the registry's default provider, which is now
 * Pexels).
 *
 * Why the file is still named `UnsplashPicker`:
 *   v12 swapped Pexels in as the active provider but kept this
 *   molecule's file name to avoid a churny rename across ~15 test
 *   ids, stories, and connector imports that don't affect users.
 *   All visible copy here is provider-neutral OR derived from the
 *   actual `photo.provider` field — never hard-coded to "Unsplash".
 *
 * UX choices worth calling out:
 *   * Submit-driven search (form `onSubmit`), NOT keystroke-driven.
 *     Stock-photo APIs cap free-tier traffic per hour and a per-
 *     keystroke search would burn that within seconds.
 *   * Click anywhere on a thumbnail to select. There's no separate
 *     "Use this image" button — the surface is small and a single
 *     click is faster.
 *   * Photographer credit is rendered under each thumbnail per
 *     each provider's attribution guidelines. The credit links to
 *     the photographer's profile + the photo page when the provider
 *     supplies them.
 *   * The previously-fetched grid stays visible while a new search
 *     is in flight (the parent hook keeps `results` until a fresh
 *     successful search lands) — gives the picker a calmer "swap-in"
 *     feel instead of a flicker to the empty state.
 */

export interface UnsplashPickerProps {
  open: boolean;
  onClose: () => void;
  /** Current value of the search input. */
  query: string;
  onQueryChange: (value: string) => void;
  /** Fired when the user submits the search form. */
  onSearch: () => void;
  /** Fired when the user clicks a thumbnail. */
  onSelect: (photo: NormalizedImageSearchResult) => void;
  /** Most recent results (or empty array). */
  results: NormalizedImageSearchResult[];
  /** Most recent total-results count from Unsplash; null before the first search. */
  totalResults: number | null;
  isSearching?: boolean;
  errorMessage?: string | null;
  /**
   * True iff the parent has fired at least one search round-trip.
   * Lets us tell apart "untouched modal" (don't show "no results")
   * from "searched and got nothing" (do show it).
   */
  hasSearched: boolean;
  /**
   * Recently-used images for this blog. When non-empty, the picker
   * surfaces a "Recently used" section above the search input. Each
   * row is a previous attribution row with cached `wpMediaId` (when
   * present) so reusing it short-circuits the WordPress upload step.
   */
  recentUploads?: RecentImageUpload[];
  /** Fired when the user clicks a recently-used thumbnail. */
  onSelectRecent?: (upload: RecentImageUpload) => void;
  className?: string;
}

export function UnsplashPicker({
  open,
  onClose,
  query,
  onQueryChange,
  onSearch,
  onSelect,
  results,
  totalResults,
  isSearching = false,
  errorMessage = null,
  hasSearched,
  recentUploads,
  onSelectRecent,
  className,
}: UnsplashPickerProps) {
  const showEmptyResults =
    hasSearched && !isSearching && results.length === 0 && !errorMessage;
  const showRecentSection =
    !hasSearched &&
    Array.isArray(recentUploads) &&
    recentUploads.length > 0 &&
    typeof onSelectRecent === "function";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pick image"
      description="Search the image library for a photo. Selecting an image only updates the form — you still need to click Save to persist the change."
      maxWidth="xl"
      className={className}
    >
      {showRecentSection ? (
        <section
          aria-label="Recently used images"
          className="mb-5 rounded-[var(--sp-radius-md)] border border-border bg-background p-3"
        >
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Recently used
            </h3>
            <p className="text-xs text-muted">
              Reuse previously-uploaded images on this blog.
            </p>
          </div>
          <ul
            data-testid="image-picker-recents"
            className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6"
          >
            {recentUploads!.map((row) => (
              <RecentUploadThumbnail
                key={row.id}
                upload={row}
                onSelect={() => onSelectRecent!(row)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isSearching) onSearch();
        }}
      >
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="image-picker-query">Search</Label>
            <Input
              id="image-picker-query"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="e.g. modern smart home cameras"
              autoComplete="off"
              disabled={isSearching}
              className="mt-1"
            />
          </div>
          <Button
            type="submit"
            size="md"
            loading={isSearching}
            disabled={isSearching || !query.trim()}
          >
            Search
          </Button>
        </div>

        {errorMessage ? (
          <p
            className="rounded-[var(--sp-radius-md)] border border-error/40 bg-error/10 p-2 text-sm text-error"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}

        {showEmptyResults ? (
          <p
            className="rounded-[var(--sp-radius-md)] border border-border bg-background p-3 text-sm text-muted"
            role="status"
          >
            No matches for{" "}
            <span className="font-medium text-foreground">
              &ldquo;{query}&rdquo;
            </span>
            . Try a broader term.
          </p>
        ) : null}

        {!hasSearched && !errorMessage ? (
          <p className="text-xs text-muted">
            Tip: search for the subject of the article (e.g. the target
            keyword).
          </p>
        ) : null}
      </form>

      {results.length > 0 ? (
        <ul
          aria-label="Image search results"
          className={cn(
            "mt-4 grid gap-3",
            // 2 columns on phones, 3 on tablets, 4 on desktop — keeps
            // each thumbnail comfortably tap-able while filling the
            // modal's `xl` max-width.
            "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
          )}
        >
          {results.map((photo) => (
            <UnsplashPickerThumbnail
              key={photo.providerPhotoId}
              photo={photo}
              onSelect={() => onSelect(photo)}
              disabled={isSearching}
            />
          ))}
        </ul>
      ) : isSearching && !hasSearched ? (
        // First-time search: render a simple spinner instead of an
        // empty grid (which would just look like "no results").
        <div className="mt-6 flex justify-center">
          <Spinner size="md" />
        </div>
      ) : null}

      {totalResults !== null && totalResults > results.length ? (
        <p className="mt-4 text-xs text-muted">
          Showing {results.length} of {totalResults.toLocaleString()} results.
          Refine your search to narrow the list.
        </p>
      ) : null}
    </Modal>
  );
}

interface UnsplashPickerThumbnailProps {
  photo: NormalizedImageSearchResult;
  onSelect: () => void;
  disabled: boolean;
}

/**
 * Each grid cell is a single button so the entire thumbnail is the
 * tap target. Photographer credit is rendered as separate `<a>`
 * elements OUTSIDE the button (so users can click them without
 * triggering the select). Photographer / link fields are nullable on
 * the generic provider type — the picker falls back to neutral copy
 * when they're missing rather than rendering "by null" / a broken
 * link, so future providers (AI gen, manual upload) plug in cleanly.
 *
 * Provider label comes from {@link providerDisplayLabel}, which
 * resolves `'pexels'` → `'Pexels'`, `'unsplash'` → `'Unsplash'`
 * (legacy historical rows still render correctly), and falls
 * through to the raw id for any unknown future provider.
 */
function UnsplashPickerThumbnail({
  photo,
  onSelect,
  disabled,
}: UnsplashPickerThumbnailProps) {
  const photographerName = photo.photographerName?.trim() || null;
  /* v8 ignore start -- defensive: providerDisplayLabel only returns "" for empty/null/non-string input, but `photo.provider` is typed `ImageProviderId` (string) and required by the picker results pipe; the `|| "image library"` fallback guards against a malformed jsonb row but is unreachable from the typed call path */
  const providerLabel = providerDisplayLabel(photo.provider) || "image library";
  /* v8 ignore stop */
  const altText =
    photo.altDescription ||
    photo.description ||
    (photographerName
      ? `Photo by ${photographerName}`
      : `Image from ${providerLabel}`);
  const ariaLabel = photographerName
    ? `Select photo by ${photographerName}`
    : "Select this photo";

  return (
    <li className="flex flex-col gap-1.5 text-xs">
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          "group relative overflow-hidden rounded-[var(--sp-radius-md)] border border-border bg-background transition-shadow",
          "hover:border-brand-blue hover:shadow-[var(--sp-shadow-md)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- third-party
            URL; we don't want next/image's domain allow-list pinned to
            stock-photo CDNs just for the picker */}
        <img
          src={photo.thumbUrl}
          alt={altText}
          className="aspect-[4/3] w-full object-cover"
          loading="lazy"
        />
      </button>
      <p className="truncate text-muted">
        Photo by{" "}
        {photo.photographerProfileUrl && photographerName ? (
          <a
            href={photo.photographerProfileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline"
          >
            {photographerName}
          </a>
        ) : (
          <span className="text-foreground">
            {photographerName ?? `a ${providerLabel} photographer`}
          </span>
        )}{" "}
        on{" "}
        {photo.photoUrl ? (
          <a
            href={photo.photoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline"
          >
            {providerLabel}
          </a>
        ) : (
          <span className="text-foreground">{providerLabel}</span>
        )}
      </p>
    </li>
  );
}

interface RecentUploadThumbnailProps {
  upload: RecentImageUpload;
  onSelect: () => void;
}

/**
 * Small thumbnail for the "Recently used" section. Smaller cells +
 * shorter credit line than the search-result thumbnails because the
 * section is meant as a glance-and-pick affordance, not a browse
 * surface. Click anywhere on the thumbnail to select.
 */
function RecentUploadThumbnail({
  upload,
  onSelect,
}: RecentUploadThumbnailProps) {
  const altText =
    upload.altText ||
    `Previously used image${
      upload.photographerName ? ` by ${upload.photographerName}` : ""
    }`;
  const ariaLabel = upload.photographerName
    ? `Reuse image by ${upload.photographerName}`
    : "Reuse this image";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-label={ariaLabel}
        title={upload.altText ?? upload.imageUrl}
        className={cn(
          "group block w-full overflow-hidden rounded-[var(--sp-radius-sm)] border border-border bg-surface transition-shadow",
          "hover:border-brand-blue hover:shadow-[var(--sp-shadow-md)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- third-party
            URL; same reason as the Unsplash thumbnails above */}
        <img
          src={upload.imageUrl}
          alt={altText}
          className="aspect-[4/3] w-full object-cover"
          loading="lazy"
        />
      </button>
    </li>
  );
}
