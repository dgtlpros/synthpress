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
   * server component for `converted_to_article` ideas (and for any
   * approved idea that has a generating/failed article placeholder).
   * Rendered as a "View article" link in the card footer.
   */
  viewArticleHref?: string | null;
  /**
   * `true` when an `article_jobs` row with status `pending` or
   * `processing` exists for this idea — i.e. the user already clicked
   * Generate Article and the workflow is still running. Survives a
   * page refresh because it comes from Supabase, not React state.
   * When set:
   *   * the Generate / Approve / Reject buttons are hidden
   *   * a "Generating…" pill renders in their place
   *   * the View Article link still renders (the placeholder article
   *     row exists with status = `generating`)
   */
  isGenerating?: boolean;
  /**
   * `true` when `article_ideas.archived_at IS NOT NULL`. Archived
   * ideas are visually muted, hide lifecycle actions (Approve /
   * Reject / Generate Article), and surface an "Unarchive" button
   * instead. Autopilot ignores archived ideas entirely (see
   * `listApprovedIdeasForBlog` + `countUsableIdeasForBacklog`).
   */
  isArchived?: boolean;
}

/**
 * Per-card pending state.
 *
 *   * `null`         — idle, all actions enabled
 *   * `"approved"`   — this card's Approve is in flight
 *   * `"rejected"`   — this card's Reject is in flight
 *   * `"generating"` — this card's Generate Article is in flight
 *   * `"archiving"`  — this card's Archive is in flight
 *   * `"unarchiving"`— this card's Unarchive is in flight
 *   * `"other"`      — a DIFFERENT card on the page is busy; our
 *                      buttons render disabled (without spinners) to
 *                      enforce the single-action-at-a-time policy
 */
export type IdeaCardPendingAction =
  | "approved"
  | "rejected"
  | "generating"
  | "archiving"
  | "unarchiving"
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
  /**
   * Archive handler. Renders an Archive button on every non-terminal,
   * non-archived card when provided. Archive is a soft-delete: the
   * idea is hidden from the active backlog but rows are preserved.
   */
  onArchive?: (ideaId: string) => void;
  /**
   * Unarchive handler. Renders an Unarchive button on archived cards
   * when provided. Restores the idea to its previous lifecycle state.
   */
  onUnarchive?: (ideaId: string) => void;
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
  onArchive,
  onUnarchive,
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
  // A persisted "generating" job is the same shape as a terminal idea
  // for our purposes: hide the action buttons, show a status pill +
  // optional "View article" link to the in-flight placeholder.
  const isGenerating = Boolean(idea.isGenerating);
  const isArchived = Boolean(idea.isArchived);
  // View article is independent of archive — archiving a published
  // idea preserves the "View article" affordance so the user can
  // still navigate to the post they tucked away.
  const showViewArticle =
    (isTerminal || isGenerating) && Boolean(idea.viewArticleHref);
  // Generate Article is only meaningful for approved ideas. Hidden
  // while a generation is already in flight (so we don't fire two
  // workflows for the same idea — the server action also prevents
  // this, but the UI shouldn't show the button). Also hidden on
  // archived cards: the spec says archived ideas are skipped by
  // autopilot, so manual generation on them would be inconsistent.
  const showGenerate =
    Boolean(onGenerate) &&
    !isTerminal &&
    !isGenerating &&
    !isArchived &&
    idea.status === "approved";
  // Approve is hidden when the idea is already approved (we surface
  // Generate Article as the primary next step instead) AND on
  // archived cards (unarchive first, then approve if needed).
  const showApprove =
    Boolean(onApprove) &&
    !isTerminal &&
    !isGenerating &&
    !isArchived &&
    idea.status !== "approved";
  const showReject =
    Boolean(onReject) &&
    !isTerminal &&
    !isGenerating &&
    !isArchived &&
    idea.status !== "rejected";
  // Archive lives on every non-archived, non-generating card —
  // including converted_to_article (a user may want to hide a
  // published topic from the backlog without re-publishing it).
  const showArchive = Boolean(onArchive) && !isArchived && !isGenerating;
  const showUnarchive = Boolean(onUnarchive) && isArchived;
  const hasFooter =
    showApprove ||
    showReject ||
    showGenerate ||
    showArchive ||
    showUnarchive ||
    showViewArticle ||
    isGenerating;

  // Disable ALL action buttons whenever any update is in flight (this
  // card or another). The button that's actually mid-call shows a
  // spinner; the others go inert.
  const anyPending = pendingAction !== null;
  const approvePending = pendingAction === "approved";
  const rejectPending = pendingAction === "rejected";
  const generatePending = pendingAction === "generating";
  const archivePending = pendingAction === "archiving";
  const unarchivePending = pendingAction === "unarchiving";

  return (
    <Card
      className={cn(
        "flex flex-col gap-3 transition-shadow hover:shadow-[var(--sp-shadow-md)]",
        // Visually de-emphasize archived cards so the active backlog
        // tabs (where archived shouldn't appear in normal use) still
        // signal "this is special" when one does render via a search
        // override or the Archived tab.
        isArchived && "opacity-70",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          className={cn(
            "line-clamp-2 text-base font-semibold text-foreground",
            isArchived && "line-through decoration-muted/40",
          )}
        >
          {idea.title}
        </h3>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {isArchived ? (
            <Badge variant="default" size="sm" aria-label="Idea is archived">
              Archived
            </Badge>
          ) : null}
          <IdeaStatusBadge status={idea.status} />
        </div>
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
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            {isGenerating ? (
              <Badge
                variant="brand"
                size="sm"
                aria-label="Article generation in progress"
              >
                Generating…
              </Badge>
            ) : null}
            {showViewArticle ? (
              <Link
                href={idea.viewArticleHref!}
                className="inline-flex h-8 items-center justify-center rounded-[var(--sp-radius-md)] border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
              >
                View article
              </Link>
            ) : null}
            {showArchive ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={archivePending}
                disabled={anyPending && !archivePending}
                onClick={() => onArchive?.(idea.id)}
              >
                Archive
              </Button>
            ) : null}
            {showUnarchive ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={unarchivePending}
                disabled={anyPending && !unarchivePending}
                onClick={() => onUnarchive?.(idea.id)}
              >
                Unarchive
              </Button>
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
