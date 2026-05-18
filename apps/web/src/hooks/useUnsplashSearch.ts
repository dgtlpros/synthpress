"use client";

import { useCallback, useState, useTransition } from "react";
import { searchUnsplash, type SearchUnsplashResult } from "@/actions/unsplash";
import type { NormalizedImageSearchResult } from "@/services/image-providers/types";

/**
 * Controller hook for the "Pick from Unsplash" picker modal.
 *
 * Owns:
 *   * The free-form `query` input value
 *   * In-flight + error state for the server action
 *   * The current page of normalized results
 *
 * UI-agnostic — the picker molecule renders whatever this returns.
 *
 * Behavior choices worth calling out:
 *   * `search()` is debounced at the call site (the picker fires it
 *     on form-submit, not on every keystroke). We don't add internal
 *     debouncing here — keystroke-driven search would burn Unsplash's
 *     50/hour free-tier quota for fresh apps.
 *   * Errors show; results from the previous query stay visible
 *     until a new successful search lands. That keeps the user
 *     oriented if they accidentally clear the input mid-browse.
 */

export interface UseUnsplashSearchOptions {
  teamId: string;
  /**
   * Initial query — typically the article's target keyword or
   * title. The hook does NOT auto-search on mount; callers fire
   * the first search when the modal opens.
   */
  initialQuery?: string;
}

export interface UseUnsplashSearchResult {
  query: string;
  setQuery: (value: string) => void;
  /**
   * Fires the server action. Optional `query` overrides the current
   * input value (used by the picker when prefilling the default
   * keyword/title query).
   */
  search: (query?: string) => void;
  /** True while the server action round-trip is in flight. */
  isSearching: boolean;
  /** Most recent result list. Empty array when no search yet OR a search returned 0 hits. */
  results: NormalizedImageSearchResult[];
  /**
   * Echoed back from the most recent successful search. `null`
   * before the first search; `0` after a search that returned no
   * hits (the picker uses this distinction for the "no matches"
   * empty-state).
   */
  totalResults: number | null;
  /** Last error message; null when idle / on success. */
  error: string | null;
  resetError: () => void;
  /**
   * True iff the picker has issued at least one search round-trip.
   * Lets the picker tell apart "untouched modal" from "searched and
   * got zero results".
   */
  hasSearched: boolean;
}

export function useUnsplashSearch({
  teamId,
  initialQuery = "",
}: UseUnsplashSearchOptions): UseUnsplashSearchResult {
  const [query, setQuery] = useState(initialQuery);
  const [isSearching, startSearch] = useTransition();
  const [results, setResults] = useState<NormalizedImageSearchResult[]>([]);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const resetError = useCallback(() => setError(null), []);

  const search = useCallback(
    (override?: string) => {
      const q = (override ?? query).trim();
      // Persist the override into the input state so the next
      // keystroke edits *that* value rather than reverting to the
      // pre-prefill value.
      if (override !== undefined) setQuery(override);
      setError(null);
      setHasSearched(true);
      startSearch(async () => {
        const result = await searchUnsplash(teamId, { query: q });
        if (result.error !== null) {
          setError(result.error);
          return;
        }
        const data = result.data as SearchUnsplashResult;
        setResults(data.results);
        // `totalResults` is optional on the generic adapter response
        // (some providers don't expose a total count); coerce to 0
        // so the picker's empty-state logic stays simple.
        setTotalResults(data.totalResults ?? 0);
      });
    },
    [query, teamId],
  );

  return {
    query,
    setQuery,
    search,
    isSearching,
    results,
    totalResults,
    error,
    resetError,
    hasSearched,
  };
}
