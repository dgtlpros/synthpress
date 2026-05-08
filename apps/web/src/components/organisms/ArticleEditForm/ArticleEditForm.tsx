import { cn } from "@/lib/cn";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import { Input } from "@/components/atoms/Input";
import { Label } from "@/components/atoms/Label";
import { MarkdownPreview } from "@/components/atoms/MarkdownPreview";
import { Textarea } from "@/components/atoms/Textarea";

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
  className?: string;
}

export function ArticleEditForm({
  value,
  onChange,
  onCancel,
  onSubmit,
  isSaving = false,
  errorMessage = null,
  className,
}: ArticleEditFormProps) {
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
