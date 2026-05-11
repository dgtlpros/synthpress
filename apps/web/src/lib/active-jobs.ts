import type { Json } from "@/lib/supabase/database.types";

/**
 * Pure types + constants for the global active-jobs widget. Lives in
 * `lib/` (not `services/`) on purpose: client-side modules need to
 * import the row shape + the recent-window constant, and pulling them
 * from `services/article-generation-service` would drag the entire
 * `server-only` graph (Stripe, Anthropic, Supabase admin) into the
 * client bundle.
 *
 * The service layer re-exports these symbols for backward
 * compatibility with existing server callers — see
 * `services/article-generation-service.ts`.
 */

/**
 * Recently-finished window for the global jobs widget. Completed /
 * failed jobs appear in the tray for ~5 minutes after they finish so
 * users notice them when they return to the app, then drop off.
 */
export const ACTIVE_JOB_RECENT_WINDOW_MS = 5 * 60_000;

/**
 * Browser CustomEvent name fired whenever something (a Generate
 * Article click today, future autopilot triggers tomorrow) queues a
 * new `article_jobs` row that the global tray should know about
 * RIGHT AWAY instead of waiting up to one poll interval.
 *
 * The tray hook (`useActiveTeamJobs`) listens for this event and
 * triggers an immediate refetch — keeps the perceived UX snappy
 * without escalating to Supabase Realtime for one feature.
 *
 * Cross-tab note: only the tab that dispatched the event refreshes
 * immediately. Other tabs still wait for the next ~8s poll. Good
 * enough for v1; if it ever becomes annoying, swap the implementation
 * for a `BroadcastChannel` of the same name without touching callers.
 */
export const JOB_QUEUED_EVENT_NAME = "synthpress:active-jobs:queued";

export interface JobQueuedEventDetail {
  jobId: string;
  articleId?: string | null;
}

/**
 * Fire the {@link JOB_QUEUED_EVENT_NAME} event. SSR-safe (no-op when
 * `window` is undefined). Callers don't need to construct the
 * `CustomEvent` themselves.
 */
export function dispatchJobQueuedEvent(detail: JobQueuedEventDetail): void {
  /* v8 ignore next 1 -- defensive: SSR safety; jsdom always has window */
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<JobQueuedEventDetail>(JOB_QUEUED_EVENT_NAME, { detail }),
  );
}

/**
 * Display row for the global active-jobs widget. Wraps the raw
 * `article_jobs` row with the small slice of related blog + article
 * data the tray needs to render a "View article" link with a friendly
 * label.
 */
export interface ActiveArticleJobRow {
  id: string;
  type: string;
  status: string;
  currentStep: string | null;
  errorMessage: string | null;
  output: Json | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  blog: { id: string; name: string; projectId: string; teamId: string };
  article: { id: string; title: string; status: string } | null;
  ideaId: string | null;
}
