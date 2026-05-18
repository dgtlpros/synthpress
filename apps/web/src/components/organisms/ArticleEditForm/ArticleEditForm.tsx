import { cn } from "@/lib/cn";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import { Input } from "@/components/atoms/Input";
import { Label } from "@/components/atoms/Label";
import { MarkdownPreview } from "@/components/atoms/MarkdownPreview";
import { Textarea } from "@/components/atoms/Textarea";
import {
  extractArticleSections,
  type ExtractedArticleSection,
} from "@/lib/extract-article-sections";

/**
 * The shape this form edits. Mirrors the controller hook
 * (`useArticleEdit.ArticleEditFormValue`) but kept as a local type so
 * the form stays a pure presentational component.
 */
export interface ArticleEditFormValue {
  title: string;
  slug: string;
  excerpt: string;
  metaDescription: string;
  targetKeyword: string;
  contentMarkdown: string;
  /**
   * Featured image URL. Empty string means "no featured image".
   * Validated as `http(s)://...` on the server. The connector
   * normalizes a stored `null` into `""` so the input renders as a
   * blank field.
   */
  featuredImageUrl: string;
  /** Accessible alt text for the featured image. */
  featuredImageAlt: string;
}

/**
 * One slot in the Section Images card — keyed by the H2 derived
 * from `value.contentMarkdown` via {@link extractArticleSections}.
 * Connector passes a map keyed by `section_key`; if a key has no
 * entry the slot renders the "Pick image" affordance.
 */
export interface SectionImageSlotValue {
  imageUrl: string;
  altText: string;
}

export interface ArticleEditFormProps {
  value: ArticleEditFormValue;
  onChange: <K extends keyof ArticleEditFormValue>(
    key: K,
    value: ArticleEditFormValue[K],
  ) => void;
  onCancel: () => void;
  onSubmit: () => void;
  isSaving?: boolean;
  errorMessage?: string | null;
  /**
   * When provided, renders a "Pick from Unsplash" button next to the
   * featured image URL input. The parent owns the picker modal +
   * search state — we just fire the callback when the user clicks
   * the button.
   */
  onPickFromUnsplash?: () => void;
  /**
   * When provided alongside `onPickSectionImage`, the form renders a
   * "Section images" card listing every H2 from `value.contentMarkdown`
   * with a pick / preview / clear / alt-edit affordance per section.
   * Keyed by `section_key` (slugified heading). Omit to hide the
   * section-image surface entirely (legacy callers).
   */
  sectionImages?: Record<string, SectionImageSlotValue>;
  /** Fires when the user clicks "Pick image" on a section slot. */
  onPickSectionImage?: (section: ExtractedArticleSection) => void;
  /** Fires when the user edits the alt text on a section slot. */
  onSectionImageAltChange?: (sectionKey: string, altText: string) => void;
  /** Fires when the user clicks "Remove" on a section slot. */
  onClearSectionImage?: (sectionKey: string) => void;
  className?: string;
}

export function ArticleEditForm({
  value,
  onChange,
  onCancel,
  onSubmit,
  isSaving = false,
  errorMessage = null,
  onPickFromUnsplash,
  sectionImages,
  onPickSectionImage,
  onSectionImageAltChange,
  onClearSectionImage,
  className,
}: ArticleEditFormProps) {
  // The Section Images card only renders when the connector wires
  // the surface in — both `sectionImages` AND a picker callback are
  // required, otherwise we have nothing actionable to show.
  const showSectionImages = Boolean(
    sectionImages !== undefined && onPickSectionImage,
  );
  // Parse the body once per render. `extractArticleSections` is
  // pure + cheap (single remark-parse pass) and re-running on every
  // keystroke is what keeps the slot list in sync with the body
  // editor without extra state.
  const sections = showSectionImages
    ? extractArticleSections(value.contentMarkdown)
    : [];
  return (
    <form
      className={cn("space-y-6", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!isSaving) onSubmit();
      }}
    >
      <Card className="space-y-4">
        <div>
          <Label htmlFor="article-edit-title">Title</Label>
          <Input
            id="article-edit-title"
            value={value.title}
            onChange={(e) => onChange("title", e.target.value)}
            disabled={isSaving}
            required
            className="mt-1"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="article-edit-slug">
              Slug <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Input
              id="article-edit-slug"
              value={value.slug}
              onChange={(e) => onChange("slug", e.target.value)}
              disabled={isSaving}
              placeholder="lowercase-hyphenated"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="article-edit-target-keyword">
              Target keyword{" "}
              <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Input
              id="article-edit-target-keyword"
              value={value.targetKeyword}
              onChange={(e) => onChange("targetKeyword", e.target.value)}
              disabled={isSaving}
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="article-edit-excerpt">
            Excerpt <span className="font-normal text-muted">(optional)</span>
          </Label>
          <Textarea
            id="article-edit-excerpt"
            value={value.excerpt}
            onChange={(e) => onChange("excerpt", e.target.value)}
            disabled={isSaving}
            placeholder="Short summary shown on listing cards."
            className="mt-1 min-h-[80px]"
          />
        </div>

        <div>
          <Label htmlFor="article-edit-meta-description">
            Meta description{" "}
            <span className="font-normal text-muted">(optional)</span>
          </Label>
          <Textarea
            id="article-edit-meta-description"
            value={value.metaDescription}
            onChange={(e) => onChange("metaDescription", e.target.value)}
            disabled={isSaving}
            placeholder="Search engine description (~155 chars)."
            className="mt-1 min-h-[80px]"
          />
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <Label htmlFor="article-edit-featured-image-url">
            Featured image URL{" "}
            <span className="font-normal text-muted">(optional)</span>
          </Label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="article-edit-featured-image-url"
              type="url"
              inputMode="url"
              value={value.featuredImageUrl}
              onChange={(e) => onChange("featuredImageUrl", e.target.value)}
              disabled={isSaving}
              placeholder="https://example.com/photo.jpg"
              className="flex-1"
            />
            {onPickFromUnsplash ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={onPickFromUnsplash}
                disabled={isSaving}
                className="shrink-0"
              >
                Pick from Unsplash
              </Button>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted">
            Direct link to a JPEG, PNG, GIF, or WebP. The image is uploaded to
            WordPress the first time you Send / Update / Publish — changing this
            URL re-uploads on the next sync.
          </p>
        </div>
        <div>
          <Label htmlFor="article-edit-featured-image-alt">
            Featured image alt text{" "}
            <span className="font-normal text-muted">(optional)</span>
          </Label>
          <Input
            id="article-edit-featured-image-alt"
            value={value.featuredImageAlt}
            onChange={(e) => onChange("featuredImageAlt", e.target.value)}
            disabled={isSaving}
            placeholder="Describe the image for screen readers and SEO."
            className="mt-1"
          />
        </div>
        {value.featuredImageUrl.trim() ? (
          <div className="rounded-[var(--sp-radius-md)] border border-border bg-background p-3">
            <p className="mb-2 text-xs font-medium text-muted">Preview</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- third-party
                URL; we don't want next/image's domain allow-list pinned to
                user-supplied hosts */}
            <img
              src={value.featuredImageUrl}
              alt={value.featuredImageAlt || "Featured image preview"}
              className="max-h-64 w-full rounded-[var(--sp-radius-md)] object-cover"
            />
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="article-edit-body">Article body (Markdown)</Label>
          <span className="text-xs text-muted">
            Markdown is the source of truth.
          </span>
        </div>
        <Textarea
          id="article-edit-body"
          value={value.contentMarkdown}
          onChange={(e) => onChange("contentMarkdown", e.target.value)}
          disabled={isSaving}
          className="min-h-[400px] font-mono text-sm"
        />
        <details className="group">
          <summary className="cursor-pointer select-none text-sm font-medium text-muted hover:text-foreground">
            Preview
          </summary>
          <div className="mt-3 rounded-[var(--sp-radius-md)] border border-border bg-background p-4">
            {value.contentMarkdown.trim() ? (
              <MarkdownPreview markdown={value.contentMarkdown} />
            ) : (
              <p className="text-sm text-muted">Nothing to preview yet.</p>
            )}
          </div>
        </details>
      </Card>

      {showSectionImages ? (
        <Card className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Section images
            </h3>
            <p className="mt-1 text-xs text-muted">
              Add an image above each major (H2) section. Images render in
              SynthPress only — section images are not yet pushed to WordPress.
            </p>
          </div>
          {sections.length === 0 ? (
            <p className="text-sm text-muted">
              Add H2 sections to your article to attach section images.
            </p>
          ) : (
            <ul className="space-y-3">
              {sections.map((section) => (
                <SectionImageSlot
                  key={section.sectionKey}
                  section={section}
                  slot={sectionImages?.[section.sectionKey]}
                  isSaving={isSaving}
                  onPick={() => onPickSectionImage?.(section)}
                  onAltChange={(alt) =>
                    onSectionImageAltChange?.(section.sectionKey, alt)
                  }
                  onClear={() => onClearSectionImage?.(section.sectionKey)}
                />
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {errorMessage ? (
        <p className="text-sm text-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={isSaving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="md"
          loading={isSaving}
          disabled={!value.title.trim()}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

interface SectionImageSlotProps {
  section: ExtractedArticleSection;
  slot: SectionImageSlotValue | undefined;
  isSaving: boolean;
  onPick: () => void;
  onAltChange: (altText: string) => void;
  onClear: () => void;
}

/**
 * One row in the Section Images card. Two visual states:
 *   - **Empty**: heading + "Pick image" button only.
 *   - **Filled**: heading + thumbnail + alt input + Remove button.
 *
 * The alt input ID derives from `section.sectionKey` so multiple
 * slots on one page each have unique label↔input pairing for screen
 * readers and `getByLabelText`.
 */
function SectionImageSlot({
  section,
  slot,
  isSaving,
  onPick,
  onAltChange,
  onClear,
}: SectionImageSlotProps) {
  const altInputId = `article-edit-section-image-alt-${section.sectionKey}`;
  const hasImage = Boolean(slot?.imageUrl.trim());
  return (
    <li className="rounded-[var(--sp-radius-md)] border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {section.sectionHeading || "(empty heading)"}
          </p>
          <p className="text-xs text-muted">
            {hasImage ? "Image attached" : "No image yet"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onPick}
            disabled={isSaving}
          >
            {hasImage ? "Replace image" : "Pick image"}
          </Button>
          {hasImage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClear}
              disabled={isSaving}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {hasImage ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element -- third-party
              URL; we don't want next/image's domain allow-list pinned to
              user-supplied hosts */}
          <img
            src={slot!.imageUrl}
            alt={slot!.altText || "Section image preview"}
            className="aspect-[16/9] w-full rounded-[var(--sp-radius-md)] object-cover sm:max-w-[160px]"
          />
          <div>
            <Label htmlFor={altInputId}>
              Section image alt text{" "}
              <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Input
              id={altInputId}
              value={slot!.altText}
              onChange={(e) => onAltChange(e.target.value)}
              disabled={isSaving}
              placeholder="Describe the image for screen readers."
              className="mt-1"
            />
          </div>
        </div>
      ) : null}
    </li>
  );
}
