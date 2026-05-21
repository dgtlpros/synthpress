/**
 * Shared types for the WordPress connection health-check feature.
 *
 * Lives in `lib/` (not `services/`) so client components can `import
 * type { WordPressConnectionTestResult }` without dragging the
 * `server-only` guard or any of the publish-service surface into
 * their bundles. The actual implementation (`testWordPressConnection`)
 * stays in `services/wordpress-connection-test-service.ts` and
 * re-exports nothing — it only imports these types.
 *
 * Splitting types from implementation is the same pattern used
 * elsewhere in the codebase whenever a server-only helper needs to
 * share its result shape with the form / connector layer.
 */

export interface WordPressConnectionTestUser {
  id: number;
  name?: string;
  slug?: string;
  roles?: string[];
}

/**
 * Per-capability flags derived from WordPress's REST `capabilities`
 * map (when present) or from `roles` as a heuristic fallback.
 *
 * Each field is `boolean | undefined`:
 *   * `true`  — WordPress explicitly granted the capability.
 *   * `false` — WordPress explicitly denied it (warning surfaced).
 *   * `undefined` — couldn't determine (legacy WP, plugin filter,
 *     custom role). UI treats `undefined` as "unknown" and stays
 *     quiet because false positives here are worse than a missing
 *     warning.
 */
export interface WordPressConnectionTestCapabilities {
  canCreatePosts?: boolean;
  canPublishPosts?: boolean;
  canUploadMedia?: boolean;
  canCreateTerms?: boolean;
}

export type WordPressConnectionTestErrorCode =
  | "missing_url"
  | "missing_username"
  | "missing_password"
  | "invalid_url"
  | "unauthorized"
  | "forbidden"
  | "rest_not_found"
  | "network_error"
  | "invalid_json"
  | "not_wordpress"
  | "unexpected";

export interface WordPressConnectionTestResult {
  /**
   * `true` iff the REST round-trip succeeded AND the response
   * carried a recognizable WordPress user id. Warnings can still
   * be present in the success case (capability limitations).
   */
  ok: boolean;
  /** Echo of the site URL the test ran against (trimmed, no trailing slash). */
  siteUrl: string;
  user?: WordPressConnectionTestUser;
  capabilities?: WordPressConnectionTestCapabilities;
  /** Non-fatal advisories (capability gaps, soft REST quirks). */
  warnings: string[];
  /** Present iff `ok === false`. Includes a UI-ready friendly message. */
  error?: {
    code: WordPressConnectionTestErrorCode;
    message: string;
  };
}
