import Link from "next/link";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/atoms/Badge";
import { ProgressBar } from "@/components/atoms/ProgressBar";
import { Spinner } from "@/components/atoms/Spinner";
import {
  type ActiveJobLabel,
  getActiveJobLabel,
} from "@/lib/active-job-labels";
import type { ActiveArticleJobRow } from "@/lib/active-jobs";

/**
 * One row in the global active-jobs tray. Dumb — receives a job row,
 * renders the human-friendly label + badge + actions, fires
 * `onDismiss(job.id)` when the user dismisses a finished row.
 *
 * Layout:
 *   [spinner / variant dot] Title              [badge]
 *   Blog · Generated for "Idea title"          [view article →]
 *   [optional error detail]                    [dismiss ×]
 */

export interface ActiveJobRowProps {
  job: ActiveArticleJobRow;
  /** Called when the user clicks the per-row dismiss button. */
  onDismiss: (jobId: string) => void;
  className?: string;
}

export function ActiveJobRow({ job, onDismiss, className }: ActiveJobRowProps) {
  const label = getActiveJobLabel({
    type: job.type,
    status: job.status,
    currentStep: job.currentStep,
    errorMessage: job.errorMessage,
    output: job.output,
  });

  const articleHref = job.article
    ? `/teams/${job.blog.teamId}/projects/${job.blog.projectId}/blogs/${job.blog.id}/posts/${job.article.id}`
    : null;
  // Only show the link for jobs whose article has a body to look at.
  // `generating` placeholder articles don't (yet); a "ready" article
  // does. Failed articles do too — we save the salvaged content.
  const showViewArticle =
    articleHref !== null &&
    (job.article?.status === "ready_for_review" ||
      job.article?.status === "failed" ||
      job.article?.status === "ready");

  // Show the progress bar for any job we have a percentage for that's
  // still in flight. Finished rows convey their state via the badge +
  // colored dot — drawing a "100%" bar there would be visual noise.
  const showProgress = label.isActive && label.progressPercent !== null;

  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 px-3 py-2.5 text-sm",
        "border-b border-border last:border-b-0",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <LeadingIndicator label={label} />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {label.label}
            </p>
            <p className="truncate text-xs text-muted">
              {job.blog.name}
              {job.article?.title ? ` · ${job.article.title}` : null}
            </p>
          </div>
        </div>
        <Badge variant={label.variant} size="sm">
          {label.isActive ? "Active" : statusBadgeLabel(label)}
        </Badge>
      </div>

      {showProgress ? (
        <div className="flex items-center gap-2 pl-6">
          <ProgressBar
            value={label.progressPercent!}
            variant={label.variant === "default" ? "default" : "brand"}
            size="sm"
            label={`${label.label} for ${job.article?.title ?? job.blog.name}`}
            className="flex-1"
          />
          <span
            className="shrink-0 text-xs tabular-nums text-muted"
            aria-hidden="true"
          >
            {label.progressPercent}%
          </span>
        </div>
      ) : null}

      {label.detail ? (
        <p className="line-clamp-2 pl-6 text-xs text-muted">{label.detail}</p>
      ) : null}

      {(showViewArticle || !label.isActive) && (
        <div className="flex items-center justify-between gap-2 pl-6">
          {showViewArticle ? (
            <Link
              href={articleHref!}
              className="text-xs font-medium text-brand-blue hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            >
              View article →
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          {!label.isActive ? (
            <button
              type="button"
              onClick={() => onDismiss(job.id)}
              aria-label={`Dismiss ${label.label}`}
              className="text-xs text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * Spinner for in-flight rows; colored dot for finished ones.
 * Inline — kept small so it can sit beside the truncated text.
 */
function LeadingIndicator({ label }: { label: ActiveJobLabel }) {
  if (label.isActive) {
    return <Spinner size="sm" className="mt-0.5 shrink-0" />;
  }
  // The `brand` variant is reserved for active rows, which use a
  // spinner instead of the dot — listing it here would be dead code.
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
        label.variant === "success" && "bg-success",
        label.variant === "error" && "bg-error",
        label.variant === "warning" && "bg-warning",
        label.variant === "default" && "bg-muted",
      )}
    />
  );
}

/**
 * Short non-active label for the trailing badge. The full label
 * already lives in the row title — the badge is just a visual cue.
 */
function statusBadgeLabel(label: ActiveJobLabel): string {
  if (label.variant === "success") return "Ready";
  if (label.variant === "warning") return "Refunded";
  if (label.variant === "error") return "Failed";
  return "Done";
}
