"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/atoms/Spinner";
import { ActiveJobRow } from "@/components/molecules/ActiveJobRow";
import type { ActiveArticleJobRow } from "@/services/article-generation-service";

/**
 * Floating "active jobs" tray — the dumb half. State for whether
 * the panel is expanded lives here; everything else (job list,
 * dismiss, polling) is owned by the connector / hook.
 *
 * Position:
 *   * Desktop (≥sm): fixed bottom-right with a 16px inset, max width
 *     ~400px. Doesn't block the right edge of the page.
 *   * Mobile (<sm): fixed bottom-center, full-width minus 16px
 *     gutter. Tap to expand into a bottom sheet that occupies most
 *     of the screen but never the whole viewport.
 *
 * Empty state:
 *   * If there's nothing to show (no active or recent jobs) we
 *     render NOTHING (return null) — the tray is a notification
 *     surface, not a chrome element. This keeps it from blocking
 *     content on quiet pages.
 */

export interface ActiveJobsTrayProps {
  jobs: ActiveArticleJobRow[];
  /** Number of in-flight jobs (drives the pill copy). */
  activeCount: number;
  onDismiss: (jobId: string) => void;
  className?: string;
}

export function ActiveJobsTray({
  jobs,
  activeCount,
  onDismiss,
  className,
}: ActiveJobsTrayProps) {
  const [expanded, setExpanded] = useState(false);

  if (jobs.length === 0) return null;

  const finishedCount = jobs.length - activeCount;

  return (
    <div
      className={cn(
        // Sticky-bottom positioning, safe inset from viewport edges.
        "fixed inset-x-3 bottom-3 z-40 flex flex-col items-stretch sm:inset-x-auto sm:bottom-4 sm:right-4 sm:left-auto sm:w-[360px] md:w-[400px]",
        className,
      )}
    >
      {expanded ? (
        <ExpandedPanel
          jobs={jobs}
          activeCount={activeCount}
          finishedCount={finishedCount}
          onCollapse={() => setExpanded(false)}
          onDismiss={onDismiss}
        />
      ) : (
        <CollapsedPill
          activeCount={activeCount}
          finishedCount={finishedCount}
          onClick={() => setExpanded(true)}
        />
      )}
    </div>
  );
}

interface CollapsedPillProps {
  activeCount: number;
  finishedCount: number;
  onClick: () => void;
}

function CollapsedPill({
  activeCount,
  finishedCount,
  onClick,
}: CollapsedPillProps) {
  // Prefer the live count in the pill copy; if there's nothing live,
  // fall back to the recent count so users coming back to a quiet
  // tab still get a nudge that something just finished.
  const label = pillLabel(activeCount, finishedCount);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={false}
      className={cn(
        "flex items-center justify-center gap-2 self-end rounded-[var(--sp-radius-full)] border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-[var(--sp-shadow-md)] transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
        // Mobile pill is full-width; desktop is auto.
        "w-full sm:w-auto",
      )}
    >
      {activeCount > 0 ? (
        <Spinner size="sm" />
      ) : (
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full bg-success"
        />
      )}
      {label}
    </button>
  );
}

function pillLabel(activeCount: number, finishedCount: number): string {
  if (activeCount > 0) {
    return activeCount === 1 ? "1 task running" : `${activeCount} tasks running`;
  }
  if (finishedCount === 1) return "1 update";
  return `${finishedCount} updates`;
}

interface ExpandedPanelProps {
  jobs: ActiveArticleJobRow[];
  activeCount: number;
  finishedCount: number;
  onCollapse: () => void;
  onDismiss: (jobId: string) => void;
}

function ExpandedPanel({
  jobs,
  activeCount,
  finishedCount,
  onCollapse,
  onDismiss,
}: ExpandedPanelProps) {
  const subtitle = panelSubtitle(activeCount, finishedCount);

  return (
    <section
      role="dialog"
      aria-label="Background tasks"
      className={cn(
        "flex flex-col rounded-[var(--sp-radius-xl)] border border-border bg-surface text-foreground shadow-[var(--sp-shadow-lg)]",
        // Cap height so very busy accounts still get a usable scroll
        // area without blowing past the viewport. The list inside
        // scrolls; the header stays put.
        "max-h-[70vh] sm:max-h-[60vh]",
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Background tasks
          </p>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse background tasks"
          aria-expanded={true}
          className="rounded-[var(--sp-radius-md)] p-1.5 text-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
        >
          <CollapseIcon />
        </button>
      </header>
      <ul
        className="min-h-0 flex-1 overflow-y-auto"
        aria-label="Background task list"
      >
        {jobs.map((job) => (
          <ActiveJobRow key={job.id} job={job} onDismiss={onDismiss} />
        ))}
      </ul>
    </section>
  );
}

function panelSubtitle(activeCount: number, finishedCount: number): string {
  const parts: string[] = [];
  if (activeCount > 0) {
    parts.push(activeCount === 1 ? "1 running" : `${activeCount} running`);
  }
  if (finishedCount > 0) {
    parts.push(
      finishedCount === 1 ? "1 finished" : `${finishedCount} finished`,
    );
  }
  /* v8 ignore next 1 -- defensive: parent returns null when jobs.length === 0 */
  if (parts.length === 0) return "No tasks";
  return parts.join(" · ");
}

function CollapseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
