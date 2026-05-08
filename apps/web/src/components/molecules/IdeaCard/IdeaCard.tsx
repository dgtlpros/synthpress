import Link from "next/link";
import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/atoms/Badge";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import {
  IdeaStatusBadge,
  type IdeaStatus,
} from "@/components/atoms/IdeaStatusBadge";

/**
 * Display shape for a single article idea. Mirrors `article_ideas`
 * minus the columns the UI doesn't need (raw_ai_response, etc.).
 */
export interface IdeaCardIdea {
  id: string;
  title: string;
  status: IdeaStatus;
  targetKeyword: string | null;
  executiveSummary: string | null;
  articleType: string | null;
  estimatedWordCount: number | null;
  createdAt: string;
  /**
   * URL to the linked article's detail page. Set by the Ideas page
   * server component for `converted_to_article` ideas; rendered as a
   * "View article" link in the card footer.
   */
  viewArticleHref?: string | null;
}

/**
 * Per-card pending state.
 *
 *   * `null`         — idle, all actions enabled
 *   * `"approved"`   — this card's Approve is in flight
 *   * `"rejected"`   — this card's Reject is in flight
 *   * `"generating"` — this card's Generate Article is in flight
 *   * `"other"`      — a DIFFERENT card on the page is busy; our
 *                      buttons render disabled (without spinners) to
 *                      enforce the single-action-at-a-time policy
 */
export type IdeaCardPendingAction =
  | "approved"
  | "rejected"
  | "generating"
  | "other";

export interface IdeaCardProps extends HTMLAttributes<HTMLDivElement> {
  idea: IdeaCardIdea;
  /** Approve handler. Omit to hide approve actions entirely. */
  onApprove?: (ideaId: string) => void;
  /** Reject handler. Omit to hide reject actions entirely. */
  onReject?: (ideaId: string) => void;
  /**
   * Generate Article handler. Only renders the button when the idea
   * is `approved` AND this prop is provided.
   */
  onGenerate?: (ideaId: string) => void;
  /** Loading / disabled hint for the action buttons. */
  pendingAction?: IdeaCardPendingAction | null;
  /** Inline error message shown beneath the action footer. */
  errorMessage?: string | null;
}

const ARTICLE_TYPE_LABELS: Record<string, string> = {
  how_to: "How-to",
  listicle: "Listicle",
  comparison: "Comparison",
  review: "Review",
  news: "News",
  opinion: "Opinion",
  tutorial: "Tutorial",
  case_study: "Case study",
};

function formatArticleType(type: string | null): string | null {
  if (!type) return null;
  return ARTICLE_TYPE_LABELS[type] ?? type;
}

function relativeTime(iso: string): string {
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

export function IdeaCard({
  idea,
  onApprove,
  onReject,
  onGenerate,
  pendingAction = null,
  errorMessage = null,
  className,
  ...props
}: IdeaCardProps) {
  const articleTypeLabel = formatArticleType(idea.articleType);

  // The convert flow owns transitions out of converted_to_article — no
  // manual approve/reject/generate UI here. Converted ideas instead
  // surface a "View article" link when the article id is known.
  const isTerminal = idea.status === "converted_to_article";
  const showViewArticle = isTerminal && Boolean(idea.viewArticleHref);
  // Generate Article is only meaningful for approved ideas.
  const showGenerate =
    Boolean(onGenerate) && !isTerminal && idea.status === "approved";
  // Approve is hidden when the idea is already approved (we surface
  // Generate Article as the primary next step instead).
  const showApprove =
    Boolean(onApprove) && !isTerminal && idea.status !== "approved";
  const showReject =
    Boolean(onReject) && !isTerminal && idea.status !== "rejected";
  const hasFooter =
    showApprove || showReject || showGenerate || showViewArticle;

  // Disable ALL action buttons whenever any update is in flight (this
  // card or another). The button that's actually mid-call shows a
  // spinner; the others go inert.
  const anyPending = pendingAction !== null;
  const approvePending = pendingAction === "approved";
  const rejectPending = pendingAction === "rejected";
  const generatePending = pendingAction === "generating";

  return (
    <Card
      className={cn(
        "flex flex-col gap-3 transition-shadow hover:shadow-[var(--sp-shadow-md)]",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-base font-semibold text-foreground">
          {idea.title}
        </h3>
        <IdeaStatusBadge status={idea.status} />
      </div>

      {idea.executiveSummary ? (
        <p className="line-clamp-3 text-sm text-muted">
          {idea.executiveSummary}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {articleTypeLabel ? (
          <Badge variant="default" size="sm">
            {articleTypeLabel}
          </Badge>
        ) : null}
        {idea.targetKeyword ? (
          <span className="inline-flex items-center gap-1">
            <span className="font-medium text-foreground">Keyword:</span>
            <span>{idea.targetKeyword}</span>
          </span>
        ) : null}
        {idea.estimatedWordCount ? (
          <span>~{idea.estimatedWordCount.toLocaleString()} words</span>
        ) : null}
        <span className="ml-auto">{relativeTime(idea.createdAt)}</span>
      </div>

      {hasFooter ? (
        <>
          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            {showViewArticle ? (
              <Link
                href={idea.viewArticleHref!}
                className="inline-flex h-8 items-center justify-center rounded-[var(--sp-radius-md)] border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
              >
                View article
              </Link>
            ) : null}
            {showReject ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={rejectPending}
                disabled={anyPending && !rejectPending}
                onClick={() => onReject?.(idea.id)}
              >
                Reject
              </Button>
            ) : null}
            {showApprove ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={approvePending}
                disabled={anyPending && !approvePending}
                onClick={() => onApprove?.(idea.id)}
              >
                Approve
              </Button>
            ) : null}
            {showGenerate ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={generatePending}
                disabled={anyPending && !generatePending}
                onClick={() => onGenerate?.(idea.id)}
              >
                Generate article
              </Button>
            ) : null}
          </div>
          {errorMessage ? (
            <p className="text-xs text-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
