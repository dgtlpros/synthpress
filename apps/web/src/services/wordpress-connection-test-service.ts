import "server-only";

import type {
  WordPressConnectionTestCapabilities,
  WordPressConnectionTestErrorCode,
  WordPressConnectionTestResult,
  WordPressConnectionTestUser,
} from "@/lib/wordpress-connection-test-types";
import { buildBasicAuthHeader } from "./wordpress-publish-service";

// Re-export the public types so existing callers (`testBlogWordPressConnection`,
// tests) keep working unchanged. Client components should import these
// from `@/lib/wordpress-connection-test-types` directly to avoid pulling
// `server-only` into their bundles.
export type {
  WordPressConnectionTestCapabilities,
  WordPressConnectionTestErrorCode,
  WordPressConnectionTestResult,
  WordPressConnectionTestUser,
};

/**
 * Connection-test surface for WordPress sites.
 *
 * Why this lives alongside `wordpress-publish-service` but in its
 * own file:
 *   * The publish service is a large, heavily-tested module. Folding
 *     a "do we have a working connection" check into it would force
 *     every test to mock more shape. A sibling module keeps the
 *     concerns separate while still sharing the auth helper
 *     (`buildBasicAuthHeader`) so the test path matches what
 *     publishing actually uses on the wire.
 *   * The Connections UI uses this BEFORE autopilot ever runs.
 *     Importing the publish service would also pull the markdown→html
 *     pipeline, the image-upload helpers, and the Supabase admin
 *     client into that route — none of which the connection test
 *     needs.
 *
 * Endpoint choice — `GET /wp-json/wp/v2/users/me?context=edit`:
 *   * Lightest WordPress REST call that authenticates and returns
 *     enough metadata to detect capabilities (`upload_files`,
 *     `publish_posts`, `edit_posts`, `manage_categories`). Calling
 *     with `context=edit` is required to get the `capabilities`
 *     block — the default `view` context omits it.
 *   * 401 here is the canonical "credentials are wrong" signal —
 *     any authenticated route would also return 401, but `users/me`
 *     has no side effects and existed in WP REST since 4.7.
 *   * 404 means the REST API itself is unreachable — either the
 *     site URL is wrong, REST is disabled by a plugin, or the
 *     `/wp-json` mount is at a non-standard path. Friendly copy
 *     points the user back at the URL field.
 *
 * Safety:
 *   * Returns plain objects only. The application password is never
 *     echoed back, never logged, never embedded in error messages
 *     (we sanitize the Basic header out of the failure paths).
 *   * `fetchImpl` is injectable so tests don't hit the network and
 *     a future runtime can swap in a wrapped fetch for tracing.
 */

export interface TestWordPressConnectionInput {
  /** Site root, e.g. `https://example.com` (no trailing `/wp-json`). */
  wpUrl: string;
  username: string;
  appPassword: string;
  /** Override the global `fetch` (tests + Node-runtime swaps). */
  fetchImpl?: typeof fetch;
}

/**
 * Build the friendly UI copy paired with each error code. Kept as
 * a const map (not inlined) so tests can assert message stability
 * without re-typing the strings and so localization later only
 * needs to translate this object.
 */
const ERROR_COPY: Record<WordPressConnectionTestErrorCode, string> = {
  missing_url: "Enter your WordPress site URL.",
  missing_username: "Enter your WordPress REST username.",
  missing_password: "Enter the WordPress Application Password.",
  invalid_url:
    "WordPress site URL must start with http:// or https:// and be a valid URL.",
  unauthorized:
    "WordPress rejected these credentials. Check the username and Application Password.",
  forbidden:
    "WordPress accepted the credentials but blocked the request. The user may not have REST API access.",
  rest_not_found:
    "The WordPress REST API could not be reached. Check the site URL and that the REST API is enabled.",
  network_error:
    "Could not reach the WordPress site. Check the URL and your network connection.",
  invalid_json:
    "The site responded but the response wasn't valid JSON. This usually means the URL is not a WordPress REST endpoint.",
  not_wordpress:
    "The site responded but the response doesn't look like the WordPress REST API. Double-check the site URL.",
  unexpected:
    "Unexpected response from WordPress. Try again, or contact support if it keeps happening.",
};

/**
 * Run a one-shot WordPress connection probe.
 *
 * Always returns a value (never throws) — the caller is the
 * Connections UI and a thrown error would force every call site
 * to add try/catch boilerplate. Errors come back in `result.error`
 * with a stable `code` and pre-baked friendly `message`.
 *
 * The check is intentionally minimal: one GET to `/wp/v2/users/me?context=edit`.
 * That call is the smallest authenticated WP-REST request that
 * also surfaces the per-user capability map we need to warn about
 * "can't upload media" / "can't publish posts" before autopilot
 * actually tries.
 */
export async function testWordPressConnection(
  input: TestWordPressConnectionInput,
): Promise<WordPressConnectionTestResult> {
  const wpUrl = input.wpUrl?.trim() ?? "";
  const username = input.username?.trim() ?? "";
  const appPassword = input.appPassword ?? "";

  if (!wpUrl) {
    return failure("missing_url", "");
  }
  if (!username) {
    return failure("missing_username", wpUrl);
  }
  if (!appPassword.trim()) {
    return failure("missing_password", wpUrl);
  }

  const normalizedUrl = wpUrl.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return failure("invalid_url", normalizedUrl);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return failure("invalid_url", normalizedUrl);
  }

  const endpoint = `${normalizedUrl}/wp-json/wp/v2/users/me?context=edit`;
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const auth = buildBasicAuthHeader(username, appPassword);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: auth,
      },
    });
  } catch {
    // Deliberately drop the underlying error message — it can include
    // the URL or internal cause text we don't want surfaced verbatim
    // in the UI. Mapping codes is enough for the user to act on.
    return failure("network_error", normalizedUrl);
  }

  if (response.status === 401) {
    return failure("unauthorized", normalizedUrl);
  }
  if (response.status === 403) {
    return failure("forbidden", normalizedUrl);
  }
  if (response.status === 404) {
    return failure("rest_not_found", normalizedUrl);
  }
  if (!response.ok) {
    return failure(
      "unexpected",
      normalizedUrl,
      `HTTP ${response.status} ${response.statusText}`.trim(),
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    return failure("invalid_json", normalizedUrl);
  }

  if (!isObject(parsedBody)) {
    return failure("not_wordpress", normalizedUrl);
  }

  const id = parsedBody.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return failure("not_wordpress", normalizedUrl);
  }

  const user: WordPressConnectionTestUser = {
    id,
    name: pickString(parsedBody, "name"),
    slug: pickString(parsedBody, "slug"),
    roles: pickStringArray(parsedBody, "roles"),
  };

  const capabilities = deriveCapabilities(parsedBody);
  const warnings = buildWarnings(capabilities);

  return {
    ok: true,
    siteUrl: normalizedUrl,
    user,
    capabilities,
    warnings,
  };
}

// ─── internals ──────────────────────────────────────────────────────────────

function failure(
  code: WordPressConnectionTestErrorCode,
  siteUrl: string,
  detailSuffix?: string,
): WordPressConnectionTestResult {
  const baseMessage = ERROR_COPY[code];
  const message = detailSuffix
    ? `${baseMessage} (${detailSuffix})`
    : baseMessage;
  return {
    ok: false,
    siteUrl,
    warnings: [],
    error: { code, message },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickString(
  src: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = src[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function pickStringArray(
  src: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const v = src[key];
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : undefined;
}

/**
 * Mapping from WordPress capability keys to our friendlier
 * field names. Drives both the `capabilities` map AND the
 * `warnings` list — keeping the source of truth in one constant
 * means a new capability needs one line, not three.
 */
const CAPABILITY_MAP = [
  { wpKey: "edit_posts", field: "canCreatePosts" },
  { wpKey: "publish_posts", field: "canPublishPosts" },
  { wpKey: "upload_files", field: "canUploadMedia" },
  { wpKey: "manage_categories", field: "canCreateTerms" },
] as const satisfies ReadonlyArray<{
  wpKey: string;
  field: keyof WordPressConnectionTestCapabilities;
}>;

/**
 * Roles that imply each capability for the heuristic fallback
 * (used when WP didn't expose a `capabilities` block — older WP,
 * plugin filter, etc.). Conservative on purpose: we only assume
 * the well-known WP role names. Any custom role keeps `undefined`
 * so the UI doesn't show a misleading warning.
 *
 * Source: https://wordpress.org/documentation/article/roles-and-capabilities/
 */
const ROLE_CAPABILITIES: Record<
  string,
  Partial<Record<keyof WordPressConnectionTestCapabilities, boolean>>
> = {
  administrator: {
    canCreatePosts: true,
    canPublishPosts: true,
    canUploadMedia: true,
    canCreateTerms: true,
  },
  editor: {
    canCreatePosts: true,
    canPublishPosts: true,
    canUploadMedia: true,
    canCreateTerms: true,
  },
  author: {
    canCreatePosts: true,
    canPublishPosts: true,
    canUploadMedia: true,
    // Authors don't have manage_categories by default.
    canCreateTerms: false,
  },
  contributor: {
    canCreatePosts: true,
    // Contributors can create drafts but can't publish or upload.
    canPublishPosts: false,
    canUploadMedia: false,
    canCreateTerms: false,
  },
  subscriber: {
    canCreatePosts: false,
    canPublishPosts: false,
    canUploadMedia: false,
    canCreateTerms: false,
  },
};

function deriveCapabilities(
  body: Record<string, unknown>,
): WordPressConnectionTestCapabilities {
  const out: WordPressConnectionTestCapabilities = {};
  const raw = isObject(body.capabilities) ? body.capabilities : null;

  if (raw) {
    for (const { wpKey, field } of CAPABILITY_MAP) {
      const v = raw[wpKey];
      if (typeof v === "boolean") out[field] = v;
    }
    return out;
  }

  // No `capabilities` block — fall back to the role heuristic.
  const roles = pickStringArray(body, "roles") ?? [];
  for (const role of roles) {
    const granted = ROLE_CAPABILITIES[role.toLowerCase()];
    if (!granted) continue;
    for (const field of Object.keys(granted) as Array<
      keyof WordPressConnectionTestCapabilities
    >) {
      const existing = out[field];
      const next = granted[field];
      if (next === true) {
        // Any role granting the capability wins.
        out[field] = true;
      } else if (next === false && existing === undefined) {
        // Only set false when nothing else has claimed true yet.
        out[field] = false;
      }
    }
  }
  return out;
}

function buildWarnings(caps: WordPressConnectionTestCapabilities): string[] {
  const warnings: string[] = [];
  if (caps.canCreatePosts === false) {
    warnings.push(
      "Connected, but this user cannot create posts. Use a WordPress user with at least the Author role.",
    );
  }
  if (caps.canPublishPosts === false && caps.canCreatePosts !== false) {
    warnings.push(
      "Connected, but this user can only create drafts — they cannot publish posts. Drafts will still be sent successfully.",
    );
  }
  if (caps.canUploadMedia === false) {
    warnings.push(
      "Connected, but this user may not be able to upload media. Featured images won't be sent to WordPress.",
    );
  }
  if (caps.canCreateTerms === false) {
    warnings.push(
      "Connected, but this user may not be able to create new categories or tags. Use existing ones when configuring publishing defaults.",
    );
  }
  return warnings;
}
