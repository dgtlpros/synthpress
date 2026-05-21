"use client";

import { useCallback, useState, useTransition } from "react";
import { testBlogWordPressConnection } from "@/actions/wordpress-connection-test";
import type { WordPressConnectionTestResult } from "@/lib/wordpress-connection-test-types";

/**
 * Owns the client-side state for the WordPress connection health
 * check button. Kept separate from `useWordPressConnection` so the
 * "save" path and the "test" path don't share an error string —
 * a failed connect attempt shouldn't wipe a successful test, and
 * vice versa.
 *
 * Why we test SAVED credentials (the server reads the row, the
 * client never POSTs the password):
 *   * The simplest safe behavior listed in the spec — we don't
 *     need to wire the unsaved form values through the action,
 *     and the user can always click "Save changes" then "Test
 *     connection" to test edited values.
 *   * Keeps the app password off the client → server wire entirely.
 *     The form sends the password on save (the existing path), but
 *     the test action just asks the server to use what's already
 *     persisted.
 */

export type WordPressConnectionTestState =
  | { phase: "idle"; result: null; actionError: null }
  | { phase: "testing"; result: null; actionError: null }
  | {
      phase: "complete";
      result: WordPressConnectionTestResult;
      actionError: null;
    }
  | { phase: "action_error"; result: null; actionError: string };

export interface UseWordPressConnectionTestOptions {
  teamId: string;
  projectId: string;
  blogId: string;
}

export interface UseWordPressConnectionTestResult {
  state: WordPressConnectionTestState;
  isTesting: boolean;
  test: () => void;
  reset: () => void;
}

const INITIAL_STATE: WordPressConnectionTestState = {
  phase: "idle",
  result: null,
  actionError: null,
};

export function useWordPressConnectionTest({
  teamId,
  projectId,
  blogId,
}: UseWordPressConnectionTestOptions): UseWordPressConnectionTestResult {
  const [isPending, startTransition] = useTransition();
  const [state, setState] =
    useState<WordPressConnectionTestState>(INITIAL_STATE);

  const test = useCallback(() => {
    setState({ phase: "testing", result: null, actionError: null });
    startTransition(async () => {
      const actionResult = await testBlogWordPressConnection({
        teamId,
        projectId,
        blogId,
      });
      if (actionResult.error !== null) {
        // Action-layer error (not signed in, blog not found, db
        // error). These never include the application password —
        // they come from the action's own error map.
        setState({
          phase: "action_error",
          result: null,
          actionError: actionResult.error,
        });
        return;
      }
      setState({
        phase: "complete",
        result: actionResult.data,
        actionError: null,
      });
    });
  }, [teamId, projectId, blogId]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return {
    state,
    isTesting: isPending,
    test,
    reset,
  };
}
