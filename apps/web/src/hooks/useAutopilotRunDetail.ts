"use client";

import { useCallback, useEffect, useState } from "react";
import { getAutopilotRunDetail } from "@/actions/autopilot";
import type { BlogAutopilotRunDetail } from "@/services/blog-autopilot-run-service";

export interface UseAutopilotRunDetailInput {
  teamId: string;
  projectId: string;
  blogId: string;
  /**
   * The run to fetch. Pass `null` when the drawer is closed — the
   * hook waits for a non-null id before calling the action so we
   * never load detail for runs the user hasn't asked for.
   */
  runId: string | null;
}

export interface UseAutopilotRunDetailResult {
  detail: BlogAutopilotRunDetail | null;
  isLoading: boolean;
  /** Server-action error message, surfaced verbatim to the drawer. */
  error: string | null;
  /**
   * Imperative re-fetch. Bumps an internal nonce so the existing
   * `useEffect` fires again with the same `runId` — needed after
   * mutations like the WordPress draft retry, where the server
   * has new job output + run counters to surface but the drawer
   * is still pointing at the same run.
   *
   * No-op when `runId === null` (the hook is idle).
   */
  refetch: () => void;
}

interface FetchState {
  detail: BlogAutopilotRunDetail | null;
  isLoading: boolean;
  error: string | null;
}

const IDLE: FetchState = { detail: null, isLoading: false, error: null };

/**
 * Lazy-loads `BlogAutopilotRunDetail` for the recent-runs drawer.
 *
 * Behavior:
 *   * `runId === null` → no fetch fires; the hook returns the idle
 *     constant. We *derive* the idle return rather than syncing it
 *     into state from an effect so React doesn't get a cascading
 *     re-render every time the drawer closes (lint rule
 *     `react-hooks/set-state-in-effect`).
 *   * `runId === '<id>'` → fires `getAutopilotRunDetail` once for
 *     that id, surfaces loading/error/data.
 *   * Switching between two non-null ids re-fetches and clears the
 *     prior payload so the drawer never flashes the wrong run's
 *     content.
 *   * An effect-scoped `cancelled` flag prevents a stale resolve
 *     from racing in after the user opened a different run (or
 *     closed the drawer entirely) before the first fetch returned.
 */
export function useAutopilotRunDetail({
  teamId,
  projectId,
  blogId,
  runId,
}: UseAutopilotRunDetailInput): UseAutopilotRunDetailResult {
  const [state, setState] = useState<FetchState>(IDLE);
  // Nonce-driven refetch: bumping `reloadNonce` adds a dependency
  // that's not part of the run's identity but still triggers the
  // load effect. Cheaper than a `useCallback`-of-fetcher pattern
  // and keeps cancellation logic (the `cancelled` flag) in one
  // place. Mutation callers do `refetch()` after a successful
  // server action.
  const [reloadNonce, setReloadNonce] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect --
   * The synchronous `setState({ isLoading: true })` is intentional:
   * we want the drawer to flip to the spinner the moment a new
   * `runId` arrives, not on the next render after the fetch resolves.
   * The async `.then` callback's setState is the rule's intended
   * pattern; both are needed for clean lazy-load UX. */
  useEffect(() => {
    if (!runId) return;

    let cancelled = false;
    setState({ detail: null, isLoading: true, error: null });

    void getAutopilotRunDetail(teamId, projectId, blogId, runId).then(
      (result) => {
        if (cancelled) return;
        if (result.error !== null) {
          setState({ detail: null, isLoading: false, error: result.error });
        } else {
          setState({ detail: result.data, isLoading: false, error: null });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [teamId, projectId, blogId, runId, reloadNonce]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const refetch = useCallback(() => {
    // Guard mirrors the effect's `if (!runId) return` so an
    // accidental `refetch()` against a closed drawer is a no-op
    // rather than triggering a spurious load when the drawer
    // re-opens.
    if (runId === null) return;
    setReloadNonce((n) => n + 1);
  }, [runId]);

  // Derive the idle return for `runId === null` without syncing it
  // into state. The internal `state` may still hold the previous
  // run's payload while the drawer animates closed; returning IDLE
  // here keeps the drawer's view-model honest.
  if (runId === null) return { ...IDLE, refetch };
  return { ...state, refetch };
}
