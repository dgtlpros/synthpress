import { cn } from "@/lib/cn";
import { providerDisplayLabel } from "@/lib/image-provider-label";
import { Badge } from "@/components/atoms/Badge";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import {
  MarkdownPreview,
  type MarkdownPreviewSectionImage,
} from "@/components/atoms/MarkdownPreview";
import {
  PostStatusBadge,
  type PostStatus,
} from "@/components/atoms/PostStatusBadge";

/**
 * Display shape for the article detail page. Mirrors `articles` minus
 * the columns the read view doesn't use (raw_ai_response, etc.).
 *
 * The connector loads the row server-side and converts it to this
 * shape so the organism stays a pure presentational component.
 */
export interface ArticleDetailData {
  id: string;
  title: string;
  /**
   * URL slug. Not displayed in the read view yet, but carried here so
   * the edit form (which IS controlled by this same data) can populate
   * its slug input without a second query.
   */
  slug: string | null;
  status: PostStatus;
  excerpt: string | null;
  metaDescription: string | null;
  targetKeyword: string | null;
  contentMarkdown: string | null;
  wordCount: number | null;
  generatedByModel: string | null;
  errorMessage: string | null;
  updatedAt: string;
  createdAt: string;
  /**
   * Numeric WordPress post id once the article has been pushed to a
   * connected WordPress site (always written together with
   * `wpPostUrl`). `null` means the article has not been sent yet —
   * the publish UI uses this to flip between "Send" and "Already
   * sent" modes.
   */
  wpPostId: number | null;
  /**
   * Public URL on the WordPress site. May be `null` even when
   * `wpPostId` is set (the WP REST response is allowed to omit
   * `link`).
   */
  wpPostUrl: string | null;
  /** Featured image URL stored on the article (or null). */
  featuredImageUrl: string | null;
  /** Featured image alt text stored on the article (or null). */
  featuredImageAlt: string | null;
  /**
   * WordPress attachment id for the featured image, set after the
   * first publish/update uploads the bytes. `null` when no upload
   * has happened yet OR when the URL was just changed (the edit
   * action clears this so the next sync re-uploads).
   */
  wpFeaturedMediaId: number | null;
  /**
   * Provider attribution for the active featured image (the latest
   * `article_image_uploads` row whose `image_url` matches
   * `featuredImageUrl`). `null` when the image was manually pasted
   * (no attribution row) or no featured image is set. Rendered as
   * "Photo by X on Unsplash" under the image card.
   */
  featuredImageAttribution: ArticleFeaturedImageAttribution | null;
  /**
   * Section image map keyed by `section_key` — passed straight
   * through to {@link MarkdownPreview}'s `sectionImagesByKey`.
   * The connector loads section rows server-side, projects them
   * into this shape, and the renderer injects each image above
   * the matching H2 in the article body.
   *
   * Empty map / `undefined` → no section images, plain body
   * rendering (legacy data, articles with no section picks).
   */
  sectionImagesByKey?: Record<string, MarkdownPreviewSectionImage>;
}

/**
 * Subset of `article_image_uploads` the read-view actually shows.
 * Only the credit-line fields — `wp_media_id` / `download_location`
 * etc. stay server-side.
 */
export interface ArticleFeaturedImageAttribution {
  /** `'unsplash'` today; reserved for `'ai'`, `'manual_url'`. */
  provider: string;
  photographerName: string | null;
  photographerProfileUrl: string | null;
  photoUrl: string | null;
}

export interface ArticleDetailProps {
  article: ArticleDetailData;
  /** Triggered when the user clicks the Edit button. Omit to hide it. */
  onEdit?: () => void;
  className?: string;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 14 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ArticleDetail({
  article,
  onEdit,
  className,
}: ArticleDetailProps) {
  return (
    <article className={cn("space-y-6", className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
            {article.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <PostStatusBadge status={article.status} />
            {article.targetKeyword ? (
              <Badge variant="default" size="sm">
                {article.targetKeyword}
              </Badge>
            ) : null}
            {article.wordCount ? (
              <span>~{article.wordCount.toLocaleString()} words</span>
            ) : null}
            {article.generatedByModel ? (
              <span>Generated by {article.generatedByModel}</span>
            ) : null}
            <span>Updated {formatRelative(article.updatedAt)}</span>
          </div>
        </div>
        {onEdit ? (
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={onEdit}
            className="shrink-0"
          >
            Edit
          </Button>
        ) : null}
      </header>

      {article.status === "failed" && article.errorMessage ? (
        <Card className="border-error/50 bg-error/5">
          <p className="text-sm font-semibold text-error">Generation failed</p>
          <p className="mt-1 text-sm text-error/80">{article.errorMessage}</p>
        </Card>
      ) : null}

      {article.featuredImageUrl ? (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Featured image
            </h2>
            {article.wpFeaturedMediaId !== null ? (
              <Badge variant="success" size="sm">
                Synced to WordPress
              </Badge>
            ) : (
              <Badge variant="default" size="sm">
                Will upload on next sync
              </Badge>
            )}
          </div>
          <div className="mt-3 overflow-hidden rounded-[var(--sp-radius-md)] border border-border bg-background">
            {/* eslint-disable-next-line @next/next/no-img-element -- third-party
                URL; we don't want next/image's domain allow-list pinned to
                user-supplied hosts */}
            <img
              src={article.featuredImageUrl}
              alt={article.featuredImageAlt || ""}
              className="max-h-80 w-full object-cover"
            />
          </div>
          {article.featuredImageAlt ? (
            <p className="mt-2 text-xs text-muted">
              <span className="font-medium text-foreground">Alt:</span>{" "}
              {article.featuredImageAlt}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted">
              No alt text — add one in Edit for screen readers and SEO.
            </p>
          )}
          {article.featuredImageAttribution ? (
            <FeaturedImageAttributionLine
              attribution={article.featuredImageAttribution}
            />
          ) : null}
        </Card>
      ) : null}

      {article.excerpt ? (
        <Card>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Excerpt
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            {article.excerpt}
          </p>
        </Card>
      ) : null}

      {article.metaDescription ? (
        <Card>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Meta description
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            {article.metaDescription}
          </p>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Article body
        </h2>
        <div className="mt-3">
          {article.contentMarkdown && article.contentMarkdown.trim() ? (
            <MarkdownPreview
              markdown={article.contentMarkdown}
              sectionImagesByKey={article.sectionImagesByKey}
            />
          ) : (
            <p className="text-sm text-muted">
              No body yet.{" "}
              {article.status === "generating"
                ? "Generation is still in progress — refresh in a moment."
                : "Click Edit to add Markdown content."}
            </p>
          )}
        </div>
      </Card>
    </article>
  );
}

/**
 * Renders the credit line under the featured image. Resolves the
 * provider's display label via {@link providerDisplayLabel} so:
 *
 *   * `'pexels'` (active)   → "Photo by X on Pexels"
 *   * `'unsplash'` (legacy) → "Photo by X on Unsplash" — historical
 *     attribution rows continue rendering correctly even though
 *     Unsplash is no longer a user-facing option.
 *   * Anything else → raw provider id; readable but visually
 *     un-branded so a malformed row surfaces instead of hiding.
 *
 * Returns `null` when there's literally nothing to attribute (e.g.
 * provider was recorded but neither photographer name nor URL is
 * present — the manual-paste / `'manual_url'` flow).
 */
function FeaturedImageAttributionLine({
  attribution,
}: {
  attribution: ArticleFeaturedImageAttribution;
}) {
  /* v8 ignore start -- defensive: providerDisplayLabel only returns "" for empty/null/non-string input, but `attribution.provider` is typed `string` and required; fallback to raw id is an unreachable forward-compat guard */
  const providerLabel =
    providerDisplayLabel(attribution.provider) || attribution.provider;
  /* v8 ignore stop */
  const showProviderClause =
    attribution.provider === "pexels" || attribution.provider === "unsplash";
  const photographerLink = attribution.photographerProfileUrl ? (
    <a
      href={attribution.photographerProfileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground hover:underline"
    >
      {attribution.photographerName ?? "the photographer"}
    </a>
  ) : (
    <span className="text-foreground">
      {attribution.photographerName ?? "the photographer"}
    </span>
  );

  // We only render the line when there's at least one piece of
  // useful attribution to surface. The publish service writes a
  // row even for `'manual_url'` provider in some future flows; we
  // don't want a bare "Photo by the photographer." with no link.
  if (!attribution.photographerName && !attribution.photographerProfileUrl) {
    return null;
  }

  // Per-provider fallback URL for the "on <Provider>" link when the
  // row didn't capture a `photoUrl`. Pexels rows usually include
  // `photoUrl` from the API, so this is mostly a defensive fallback
  // for legacy / partially-populated rows.
  const providerFallbackUrl =
    attribution.provider === "pexels"
      ? "https://www.pexels.com"
      : attribution.provider === "unsplash"
        ? "https://unsplash.com"
        : null;

  return (
    <p className="mt-2 text-xs text-muted">
      Photo by {photographerLink}
      {showProviderClause ? (
        <>
          {" on "}
          {/* v8 ignore start -- defensive: this block only runs when showProviderClause is true (provider ∈ {pexels, unsplash}), so providerFallbackUrl is always non-null and `?? "#"` is unreachable */}
          <a
            href={attribution.photoUrl ?? providerFallbackUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline"
          >
            {providerLabel}
          </a>
          {/* v8 ignore stop */}
        </>
      ) : null}
    </p>
  );
}
