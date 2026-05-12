"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveTeamJobs } from "@/actions/article-generation";
import {
  type ActiveArticleJobRow,
  ACTIVE_JOB_RECENT_WINDOW_MS,
  JOB_QUEUED_EVENT_NAME,
} from "@/lib/active-jobs";
import { getActiveJobLabel } from "@/lib/active-job-labels";

/**
 * Exported for tests. Public consumers shouldn't depend on these.
 */
export const __DISMISSED_EVICTION_FACTOR = 4;

/**
 * Controller hook for the global active-jobs tray.
 *
 * Pulls in all `article_jobs` the signed-in user can see (RLS scopes
 * to their teams), polls every {@link DEFAULT_POLL_MS} milliseconds
 * while the document is visible, and merges in a localStorage-backed
 * "dismissed" set so users who close a "Generation failed" row don't
 * see it bounce back on the next poll.
 *
 * Three load semantics:
 *
 *   * `loading` — first fetch in flight.
 *   * `error` — the most recent fetch errored. We keep showing the
 *     last good `jobs` so the UI doesn't flicker; a transient
 *     network blip should never empty the tray.
 *   * `jobs` — current view, with dismissed-but-finished rows
 *     filtered out. Active rows (pending / processing) are NEVER
 *     hidden by the dismiss filter — that would lose work in flight.
 */

const DEFAULT_POLL_MS = 8_000;

const DISMISSED_STORAGE_KEY = "synthpress.activeJobs.dismissed.v1";
/**
 * Bound the dismissed-id list so it can't grow unbounded across
 * months of usage. Newest entries win; oldest get evicted.
 */
const DISMISSED_MAX = 200;

/**
 * Storage shape: `{ id: string; ts: number }[]`. Keeping a timestamp
 * lets us evict entries older than the recent-window cutoff so we
 * don't keep a year of dead ids in localStorage.
 */
interface DismissedEntry {
  id: string;
  ts: number;
}

function readDismissed(): DismissedEntry[] {
  /* v8 ignore next 1 -- defensive: SSR safety, useEffect already guards */
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is DismissedEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as DismissedEntry).id === "string" &&
        typeof (e as DismissedEntry).ts === "number",
    );
  } catch {
    return [];
  }
}

function writeDismissed(entries: DismissedEntry[]): void {
  /* v8 ignore next 1 -- defensive: SSR safety */
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(entries));
    /* v8 ignore start -- defensive: localStorage quota / private mode */
  } catch {
    // Best effort. If localStorage is unavailable we lose dismissals
    // across reloads but the in-memory state still works.
  }
  /* v8 ignore stop */
}

export interface UseActiveTeamJobsOptions {
  /** Override the poll interval (mostly for tests). */
  pollIntervalMs?: number;
  /**
   * Skip the polling loop entirely (mostly for tests). The hook
   * still does an initial fetch on mount.
   */
  disablePolling?: boolean;
}

export interface UseActiveTeamJobsResult {
  /** Jobs to render, with dismissed-finished rows filtered out. */
  jobs: ActiveArticleJobRow[];
  /** Number of in-flight (pending/processing) jobs — drives the pill. */
  activeCount: number;
  /** First-load flag. `true` until the initial fetch resolves. */
  loading: boolean;
  /** Most recent fetch error message, or null. */
  error: string | null;
  /**
   * Soft-dismiss a finished job locally. No-op for active jobs (they
   * cannot be hidden from view).
   */
  dismiss: (jobId: string) => void;
}

export function useActiveTeamJobs(
  options: UseActiveTeamJobsOptions = {},
): UseActiveTeamJobsResult {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const [jobs, setJobs] = useState<ActiveArticleJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<DismissedEntry[]>([]);

  // Cancel-in-flight refs so a stale response from before a poll
  // tick never overwrites a newer one.
  const seqRef = useRef(0);

  /* eslint-disable react-hooks/set-state-in-effect --
     Reading localStorage during the lazy `useState` initializer
     would cause an SSR/CSR hydration mismatch (server returns [],
     client might return entries), so we hydrate in an effect. */
  // Hydrate dismissed-id state from localStorage on mount AND evict
  // entries older than the recent-window cutoff in the same pass so
  // the list can't grow unbounded across long usage.
  useEffect(() => {
    const cutoff =
      Date.now() - ACTIVE_JOB_RECENT_WINDOW_MS * __DISMISSED_EVICTION_FACTOR;
    const stored = readDismissed();
    const fresh = stored.filter((e) => e.ts >= cutoff);
    if (fresh.length !== stored.length) {
      writeDismissed(fresh);
    }
    setDismissed(fresh);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const fetchJobs = useCallback(async () => {
    const mySeq = ++seqRef.current;
    const result = await getActiveTeamJobs();
    /* v8 ignore next 1 -- defensive: stale response after newer one finished */
    if (mySeq !== seqRef.current) return;
    if (result.error) {
      setError(result.error);
    } else {
      setError(null);
      // `data` is non-null when `error` is null per the action contract;
      // narrow defensively so a future API change can't push `null`
      // into our state.
      setJobs(result.data ?? []);
    }
    setLoading(false);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect --
     This effect is the textbook "fetch external data on mount +
     poll" pattern. `fetchJobs` indirectly calls setState (loading,
     error, jobs), which the lint rule flags, but there's no
     alternative way to do polling + visibility-aware start/stop
     without an effect that eventually triggers setState. The React
     docs endorse this pattern for data sources that don't have a
     separate library wrapper. */
  // Initial fetch + polling + cross-component "job queued" listener.
  useEffect(() => {
    void fetchJobs();

    // Always listen for the JOB_QUEUED event — even when polling is
    // disabled (tests use `disablePolling`, but a Generate Article
    // click should still nudge the tray).
    function handleQueued() {
      void fetchJobs();
    }
    window.addEventListener(JOB_QUEUED_EVENT_NAME, handleQueued);

    if (options.disablePolling) {
      return () => {
        window.removeEventListener(JOB_QUEUED_EVENT_NAME, handleQueued);
      };
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    function start() {
      stop();
      intervalId = setInterval(() => {
        void fetchJobs();
      }, pollIntervalMs);
    }
    function stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        // Refresh immediately on return so the user sees an up-to-date
        // tray instead of waiting up to a full poll interval. Skipped
        // at the very first call because the initial `void fetchJobs()`
        // above already covered it.
        if (bootstrapped) void fetchJobs();
        start();
      } else {
        stop();
      }
      bootstrapped = true;
    }

    // Bootstrap from the current visibility state via `handleVisibility`
    // so the start/stop branch logic lives in exactly one place.
    let bootstrapped = false;
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(JOB_QUEUED_EVENT_NAME, handleQueued);
    };
  }, [fetchJobs, pollIntervalMs, options.disablePolling]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const dismiss = useCallback(
    (jobId: string) => {
      setDismissed((prev) => {
        // Don't allow active jobs to be dismissed — even though the
        // filter below already protects this, it's cheaper to no-op
        // here than to keep growing the list.
        const matching = jobs.find((j) => j.id === jobId);
        if (matching) {
          const label = getActiveJobLabel({
            type: matching.type,
            status: matching.status,
            currentStep: matching.currentStep,
            errorMessage: matching.errorMessage,
            output: matching.output,
          });
          if (label.isActive) return prev;
        }

        const next = prev.filter((e) => e.id !== jobId);
        next.unshift({ id: jobId, ts: Date.now() });
        const trimmed = next.slice(0, DISMISSED_MAX);
        writeDismissed(trimmed);
        return trimmed;
      });
    },
    [jobs],
  );

  const dismissedIds = useMemo(
    () => new Set(dismissed.map((e) => e.id)),
    [dismissed],
  );

  const visibleJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (!dismissedIds.has(job.id)) return true;
      const label = getActiveJobLabel({
        type: job.type,
        status: job.status,
        currentStep: job.currentStep,
        errorMessage: job.errorMessage,
        output: job.output,
      });
      // Active jobs are never hidden by the dismiss filter.
      return label.isActive;
    });
  }, [jobs, dismissedIds]);

  const activeCount = useMemo(
    () =>
      visibleJobs.filter((job) => {
        const label = getActiveJobLabel({
          type: job.type,
          status: job.status,
          currentStep: job.currentStep,
          errorMessage: job.errorMessage,
          output: job.output,
        });
        return label.isActive;
      }).length,
    [visibleJobs],
  );

  return {
    jobs: visibleJobs,
    activeCount,
    loading,
    error,
    dismiss,
  };
}
