import { type ReactNode, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Drawer } from "@/components/atoms/Drawer";
import {
  AutopilotRunStatusBadge,
  type AutopilotRunStatus,
} from "@/components/atoms/AutopilotRunStatusBadge";
import { PostStatusBadge, type PostStatus } from "@/components/atoms/PostStatusBadge";
import { IdeaStatusBadge, type IdeaStatus } from "@/components/atoms/IdeaStatusBadge";
import { Spinner } from "@/components/atoms/Spinner";
import type { BlogAutopilotRunDetail } from "@/services/blog-autopilot-run-service";

/**
 * Right-anchored drawer (or mobile bottom sheet) that shows the
 * full audit picture for one `blog_autopilot_runs` row:
 *   * status / trigger / timestamps
 *   * counters (ideas, auto-approved, articles, tokens)
 *   * skipped reason / failure / autopilotPaused warning
 *   * budget + backlog snapshot
 *   * spawned article jobs with deep links into the post detail page
 *   * generated / approved / converted ideas
 *   * raw input/output jsonb (collapsed by default)
 *
 * Pure presentational organism — receives the loaded detail (or
 * loading / error / empty states) and renders. The connector hosts
 * the {@link useAutopilotRunDetail} hook + lifecycle.
 */

export interface AutopilotRunDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  /** `null` while the action is in flight or before runId resolved. */
  detail: BlogAutopilotRunDetail | null;
  isLoading: boolean;
  /** Server-action error message (e.g. "Run not found."). */
  error: string | null;
  /**
   * Routes used to deep-link spawned article jobs to the post
   * detail page. Composed as `${postsHref}/${articleId}`.
   * Optional — when omitted, article rows show the title without
   * a clickable link.
   */
  postsHref?: string;
  /**
   * Where the "go to Automation tab" CTA points when the run is
   * marked auto-paused. Optional.
   */
  automationSettingsHref?: string;
  className?: string;
}

const TRIGGER_SOURCE_LABELS: Record<string, string> = {
  cron: "Scheduled",
  manual: "Manual",
  workflow: "Workflow",
  system: "System",
};

const STEP_LABELS: Record<string, string> = {
  loading_settings: "Loading settings",
  checking_budget: "Checking budget",
  checking_backlog: "Checking backlog",
  generating_ideas: "Generating ideas",
  generating_articles: "Generating articles",
  completed: "Completed",
};

function formatTriggerSource(source: string): string {
  return TRIGGER_SOURCE_LABELS[source] ?? source;
}

function formatStep(step: string | null): string | null {
  if (!step) return null;
  return STEP_LABELS[step] ?? step;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  /* v8 ignore next 1 -- defensive: Postgres timestamps always parse */
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function AutopilotRunDetailDrawer({
  open,
  onClose,
  detail,
  isLoading,
  error,
  postsHref,
  automationSettingsHref,
  className,
}: AutopilotRunDetailDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Autopilot run details"
      description="Audit log for this scheduler tick."
      width="2xl"
      className={className}
    >
      {isLoading ? (
        <div
          className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted"
          data-testid="autopilot-detail-loading"
        >
          <Spinner />
          <p>Loading run details…</p>
        </div>
      ) : error ? (
        <div
          className="rounded-[var(--sp-radius-md)] border border-error/30 bg-error/10 p-4 text-sm text-error"
          role="alert"
        >
          {error}
        </div>
      ) : detail ? (
        <DetailBody
          detail={detail}
          postsHref={postsHref}
          automationSettingsHref={automationSettingsHref}
        />
      ) : (
        <p className="py-6 text-center text-sm text-muted">
          No run selected.
        </p>
      )}
    </Drawer>
  );
}

function DetailBody({
  detail,
  postsHref,
  automationSettingsHref,
}: {
  detail: BlogAutopilotRunDetail;
  postsHref?: string;
  automationSettingsHref?: string;
}) {
  const { run, jobs, articles, ideas } = detail;
  const output = readObject(run.output);
  const inputObj = readObject(run.input);
  const ideasAutoApproved = readNumber(output?.ideasAutoApproved);
  const reason =
    typeof output?.reason === "string" && output.reason.length > 0
      ? output.reason
      : null;
  const autopilotPaused = output?.autopilotPaused === true;
  const budget = readObject(output?.budget);
  const daily = readObject(output?.daily);
  const backlog = readObject(output?.backlog);
  const articlesById = new Map(articles.map((a) => [a.id, a]));

  return (
    <div className="space-y-6 text-sm">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <AutopilotRunStatusBadge status={run.status as AutopilotRunStatus} />
            <span className="text-xs text-muted">
              {formatTriggerSource(run.trigger_source)}
            </span>
            {formatStep(run.current_step) ? (
              <>
                <span className="text-xs text-muted">·</span>
                <span className="text-xs text-muted">
                  {formatStep(run.current_step)}
                </span>
              </>
            ) : null}
          </div>
          <p className="text-xs text-muted">
            <span className="font-medium text-foreground">Created:</span>{" "}
            {formatTimestamp(run.created_at)}
          </p>
          <p className="text-xs text-muted">
            <span className="font-medium text-foreground">
              {run.completed_at ? "Completed:" : "Status:"}
            </span>{" "}
            {run.completed_at ? formatTimestamp(run.completed_at) : "Still running"}
          </p>
          <p className="font-mono text-[10px] text-muted/70">
            run id: {run.id}
          </p>
        </div>
      </header>

      {/* Auto-paused warning */}
      {autopilotPaused ? (
        <Section
          title="Autopilot paused"
          tone="warning"
          testId="autopilot-paused-detail-warning"
        >
          <p>
            Autopilot was paused because multiple recent runs failed.
          </p>
          {automationSettingsHref ? (
            <p className="mt-2">
              Re-enable from the{" "}
              <Link
                href={automationSettingsHref}
                className="font-medium underline hover:no-underline"
              >
                Automation tab
              </Link>{" "}
              once you&apos;ve reviewed the failures below.
            </p>
          ) : (
            <p className="mt-2">
              Re-enable from the Automation tab once you&apos;ve reviewed the
              failures below.
            </p>
          )}
        </Section>
      ) : null}

      {/* Summary counters */}
      <Section title="Summary">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <Counter label="Ideas generated" value={run.ideas_generated} />
          <Counter label="Auto-approved" value={ideasAutoApproved} />
          <Counter label="Article jobs started" value={run.articles_started} />
          <Counter label="Articles completed" value={run.articles_completed} />
          <Counter
            label="Articles failed"
            value={run.articles_failed}
            tone={run.articles_failed > 0 ? "error" : undefined}
          />
          <Counter label="Tokens spent" value={run.tokens_spent} />
          <Counter
            label="Tokens refunded"
            value={run.tokens_refunded}
            tone={run.tokens_refunded > 0 ? "warning" : undefined}
          />
        </dl>
      </Section>

      {/* Reason / error */}
      {run.error_message ? (
        <Section title="Failure">
          <p
            className="rounded-[var(--sp-radius-md)] border border-error/30 bg-error/10 p-3 text-error"
            role="alert"
          >
            {run.error_message}
          </p>
        </Section>
      ) : reason ? (
        <Section title="Reason">
          <p className="text-muted">{reason}</p>
        </Section>
      ) : null}

      {/* Budget / daily / backlog */}
      {budget || daily || backlog ? (
        <Section title="Budget &amp; backlog">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {budget ? (
              <Card label="Tokens">
                <Row k="Balance" v={readNumber(budget.tokenBalance)} />
                <Row k="Spent today" v={readNumber(budget.tokensSpentToday)} />
                <Row
                  k="Remaining (per-blog cap)"
                  v={
                    budget.tokensRemainingFromBudget === null
                      ? "no cap"
                      : readNumber(budget.tokensRemainingFromBudget)
                  }
                />
              </Card>
            ) : null}
            {daily ? (
              <Card label="Daily articles">
                <Row k="Cap" v={readNumber(daily.cap)} />
                <Row
                  k="Started today"
                  v={readNumber(daily.articlesStartedToday)}
                />
              </Card>
            ) : null}
            {backlog ? (
              <Card label="Idea backlog">
                <Row
                  k="Approved available"
                  v={readNumber(backlog.approvedIdeasAvailable)}
                />
              </Card>
            ) : null}
          </div>
        </Section>
      ) : null}

      {/* Spawned article jobs */}
      <Section title={`Article jobs (${jobs.length})`}>
        {jobs.length === 0 ? (
          <p className="text-muted">No article jobs spawned by this run.</p>
        ) : (
          <ul
            aria-label="Article jobs spawned by this run"
            className="divide-y divide-border rounded-[var(--sp-radius-md)] border border-border"
          >
            {jobs.map((job) => {
              const article = job.articleId
                ? articlesById.get(job.articleId)
                : undefined;
              const refunded =
                readObject(job.output)?.refunded === true;
              return (
                <li
                  key={job.id}
                  className="flex flex-col gap-1.5 px-3 py-2"
                  data-testid={`autopilot-job-${job.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {article?.title ?? jobTitleFallback(job.type)}
                    </span>
                    {article ? (
                      <PostStatusBadge
                        status={article.status as PostStatus}
                      />
                    ) : null}
                    <span className="text-xs text-muted">·</span>
                    <span className="text-xs text-muted">
                      Job: {job.status}
                      {job.currentStep ? ` (${job.currentStep})` : ""}
                    </span>
                    {refunded ? (
                      <span className="text-xs text-warning">· Refunded</span>
                    ) : null}
                  </div>
                  {job.errorMessage ? (
                    <p className="text-xs text-error" role="alert">
                      {job.errorMessage}
                    </p>
                  ) : null}
                  {article && postsHref ? (
                    <Link
                      href={`${postsHref}/${article.id}`}
                      className="text-xs font-medium text-brand-blue hover:underline"
                    >
                      View article →
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Ideas */}
      {ideas.length > 0 ? (
        <Section title={`Ideas (${ideas.length})`}>
          <ul
            aria-label="Ideas referenced by this run"
            className="divide-y divide-border rounded-[var(--sp-radius-md)] border border-border"
          >
            {ideas.map((idea) => (
              <li
                key={idea.id}
                className="flex flex-col gap-1 px-3 py-2"
                data-testid={`autopilot-idea-${idea.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">
                    {idea.title}
                  </span>
                  <IdeaStatusBadge status={idea.status as IdeaStatus} />
                </div>
                {idea.targetKeyword ? (
                  <p className="text-xs text-muted">
                    Target keyword: {idea.targetKeyword}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* Raw input / output jsonb */}
      <RawJsonSection title="Raw run input" payload={inputObj} testId="raw-input" />
      <RawJsonSection title="Raw run output" payload={output} testId="raw-output" />
      {/* Hint that the maps for idea→approved status are derivable */}
      <p className="text-[11px] text-muted/70">
        Tip: ideas marked <em>approved</em> here were auto-approved by this
        run when <code>requireReview</code> was off; otherwise they were
        approved separately.
      </p>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Section({
  title,
  tone,
  children,
  testId,
}: {
  title: ReactNode;
  tone?: "warning";
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-2",
        tone === "warning"
          ? "rounded-[var(--sp-radius-md)] border border-warning/40 bg-warning/10 p-3 text-warning"
          : null,
      )}
      data-testid={testId}
    >
      <h3
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          tone === "warning" ? "text-warning" : "text-muted",
        )}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "error" | "warning";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd
        className={cn(
          "text-base font-semibold tabular-nums text-foreground",
          tone === "error" ? "text-error" : null,
          tone === "warning" ? "text-warning" : null,
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Card({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[var(--sp-radius-md)] border border-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <div className="mt-1.5 space-y-1">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted">{k}</span>
      <span className="font-medium tabular-nums text-foreground">{v}</span>
    </div>
  );
}

function RawJsonSection({
  title,
  payload,
  testId,
}: {
  title: string;
  payload: Record<string, unknown> | null;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!payload) return null;
  return (
    <details
      className="rounded-[var(--sp-radius-md)] border border-border"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      data-testid={testId}
    >
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted hover:text-foreground">
        {title}
      </summary>
      {open ? (
        <pre className="overflow-x-auto border-t border-border bg-surface-hover px-3 py-2 text-[11px] text-foreground">
          {JSON.stringify(payload, null, 2)}
        </pre>
      ) : null}
    </details>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function readObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function readNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function jobTitleFallback(jobType: string): string {
  if (jobType === "generate_ideas") return "Generate ideas";
  if (jobType === "generate_article") return "Generate article";
  return jobType;
}
