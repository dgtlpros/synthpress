/**
 * Parser + types for the `synthpress.wordpressConnection` package
 * exported by the SynthPress WordPress companion plugin.
 *
 * The plugin renders a JSON blob in a textarea (see
 * `wordpress/wp-content/plugins/synthpress/`). Admins paste that
 * blob into the SynthPress dashboard so the dashboard can pre-fill
 * the WordPress URL, suggest a username, and show the readiness
 * checks the plugin already ran inside WordPress.
 *
 * Security posture:
 *   * The package is treated as **untrusted input** even though it
 *     came from a trusted plugin — the user might paste anything.
 *   * Application Passwords (and any field that looks like a secret)
 *     are explicitly stripped + warned about. A malicious package
 *     could include `wp_app_password` to try to trick the dashboard
 *     into auto-filling it; this parser refuses.
 *   * Unknown fields are silently dropped. Whitelist-only output.
 *   * URLs must be http(s); other schemes (`javascript:`, `data:`,
 *     `file:`) are rejected via the same regex used by the rest of
 *     the form.
 *   * The parser never makes a network call, never throws, and
 *     never mutates the input.
 *
 * Lives in `lib/` so the client paste-flow UI can import it without
 * pulling any server-only modules.
 */

/** Constant matched against `package.kind`. */
export const WORDPRESS_CONNECTION_PACKAGE_KIND =
  "synthpress.wordpressConnection" as const;

/**
 * The only schema version we currently understand. Bump this when
 * the plugin starts emitting incompatible packages; older clients
 * will reject the new version with `unsupported_schema_version`
 * rather than mis-parse.
 */
export const WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION = 1 as const;

/**
 * Soft cap on how much string we accept from any single field.
 * Names / labels / messages are bounded so a pathological package
 * can't render a 5 MB textarea on the next page render.
 */
const MAX_STRING_LENGTH = 2048;
const MAX_URL_LENGTH = 2048;
const MAX_READINESS_ROWS = 32;
const MAX_RECOMMENDED_ROLES = 16;

const URL_PATTERN = /^https?:\/\/.+/i;

/**
 * Field names this parser refuses to read from the package. We keep
 * this list together so a future audit grep on `wp_app_password`
 * lands here.
 *
 * The recursive walker treats ANY occurrence of these keys (top
 * level, inside `site`, anywhere) as a tampering signal — the
 * legitimate plugin never emits them, so the only paths that
 * produce one are typo'd hand-edits and intentional attacks.
 */
const FORBIDDEN_KEYS: readonly string[] = [
  "password",
  "applicationPassword",
  "application_password",
  "appPassword",
  "app_password",
  "wp_app_password",
  "wpAppPassword",
  "secret",
  "apiKey",
  "api_key",
  "token",
  "accessToken",
  "access_token",
];

export const WORDPRESS_CONNECTION_PACKAGE_READINESS_STATUSES = [
  "pass",
  "warning",
  "fail",
] as const;

export type WordPressConnectionPackageReadinessStatus =
  (typeof WORDPRESS_CONNECTION_PACKAGE_READINESS_STATUSES)[number];

export interface WordPressConnectionPackageReadinessRow {
  key: string;
  label: string;
  status: WordPressConnectionPackageReadinessStatus;
  message: string;
}

export interface WordPressConnectionPackageSite {
  /** Site display name (`get_bloginfo("name")`). */
  name?: string;
  /** Site URL (`home_url()`) — required, http(s). */
  url: string;
  adminUrl?: string;
  restUrl?: string;
  wordpressVersion?: string;
}

export interface WordPressConnectionPackagePluginInfo {
  installed?: boolean;
  version?: string;
}

export interface WordPressConnectionPackageRecommendedUser {
  login?: string;
  exists?: boolean;
  roles?: string[];
}

export interface WordPressConnectionPackage {
  kind: typeof WORDPRESS_CONNECTION_PACKAGE_KIND;
  schemaVersion: typeof WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION;
  exportedAt?: string;
  site: WordPressConnectionPackageSite;
  plugin?: WordPressConnectionPackagePluginInfo;
  recommendedUser?: WordPressConnectionPackageRecommendedUser;
  readiness?: WordPressConnectionPackageReadinessRow[];
}

export type WordPressConnectionPackageParseErrorCode =
  | "empty_input"
  | "invalid_json"
  | "not_an_object"
  | "wrong_kind"
  | "unsupported_schema_version"
  | "missing_site"
  | "missing_site_url"
  | "invalid_site_url";

export interface WordPressConnectionPackageParseError {
  code: WordPressConnectionPackageParseErrorCode;
  /** UI-ready, human-readable copy. Always non-empty. */
  message: string;
}

export type WordPressConnectionPackageParseResult =
  | {
      ok: true;
      package: WordPressConnectionPackage;
      /** Non-fatal advisories (dropped rows, stripped secrets, etc). */
      warnings: string[];
    }
  | {
      ok: false;
      error: WordPressConnectionPackageParseError;
    };

// ─── public entry point ────────────────────────────────────────────────

/**
 * Parse + validate a pasted connection package. Always returns a
 * tagged result — callers don't have to catch.
 */
export function parseWordPressConnectionPackageJson(
  jsonText: string,
): WordPressConnectionPackageParseResult {
  /* v8 ignore next 3 -- defensive: callers from TS receive `string` per
     the signature; the `?? ""` guard exists only for hand-rolled JS
     callers that might pass `null` / `undefined` through. */
  const trimmed = (typeof jsonText === "string" ? jsonText : "").trim();
  if (trimmed === "") {
    return {
      ok: false,
      error: {
        code: "empty_input",
        message: "Paste the connection package JSON to continue.",
      },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_json",
        message:
          "Could not parse JSON. Copy the package again from Settings → SynthPress.",
      },
    };
  }

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: {
        code: "not_an_object",
        message:
          "Connection package must be a JSON object exported by the SynthPress plugin.",
      },
    };
  }

  if (raw.kind !== WORDPRESS_CONNECTION_PACKAGE_KIND) {
    return {
      ok: false,
      error: {
        code: "wrong_kind",
        message: "This JSON is not a SynthPress WordPress connection package.",
      },
    };
  }

  if (raw.schemaVersion !== WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: "unsupported_schema_version",
        message:
          "Unsupported package schema. Update the SynthPress plugin or this dashboard and try again.",
      },
    };
  }

  if (!isPlainObject(raw.site)) {
    return {
      ok: false,
      error: {
        code: "missing_site",
        message: "Connection package is missing a `site` block.",
      },
    };
  }

  const rawUrl = raw.site.url;
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return {
      ok: false,
      error: {
        code: "missing_site_url",
        message: "Connection package is missing `site.url`.",
      },
    };
  }
  const siteUrl = clampString(rawUrl.trim(), MAX_URL_LENGTH);
  if (!URL_PATTERN.test(siteUrl)) {
    return {
      ok: false,
      error: {
        code: "invalid_site_url",
        message: "`site.url` must start with http:// or https://.",
      },
    };
  }

  const warnings: string[] = [];

  // Walk the entire input once and flag any forbidden keys (no
  // matter how deeply nested or how the attacker tries to hide them).
  if (containsForbiddenKey(raw)) {
    warnings.push(
      "Ignored fields in the package that looked like credentials (password, api key, token). The Application Password must still be pasted separately.",
    );
  }

  const site: WordPressConnectionPackageSite = { url: siteUrl };
  const siteName = readOptionalString(raw.site.name);
  if (siteName !== undefined) site.name = siteName;
  const adminUrl = readOptionalUrl(raw.site.adminUrl);
  if (adminUrl !== undefined) site.adminUrl = adminUrl;
  const restUrl = readOptionalUrl(raw.site.restUrl);
  if (restUrl !== undefined) site.restUrl = restUrl;
  const wpVersion = readOptionalString(raw.site.wordpressVersion);
  if (wpVersion !== undefined) site.wordpressVersion = wpVersion;

  const result: WordPressConnectionPackage = {
    kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
    schemaVersion: WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION,
    site,
  };

  const exportedAt = readOptionalString(raw.exportedAt);
  if (exportedAt !== undefined) result.exportedAt = exportedAt;

  if (isPlainObject(raw.plugin)) {
    const plugin: WordPressConnectionPackagePluginInfo = {};
    if (typeof raw.plugin.installed === "boolean") {
      plugin.installed = raw.plugin.installed;
    }
    const pluginVersion = readOptionalString(raw.plugin.version);
    if (pluginVersion !== undefined) plugin.version = pluginVersion;
    if (plugin.installed !== undefined || plugin.version !== undefined) {
      result.plugin = plugin;
    }
  }

  if (isPlainObject(raw.recommendedUser)) {
    const recommended: WordPressConnectionPackageRecommendedUser = {};
    const login = readOptionalString(raw.recommendedUser.login);
    if (login !== undefined) recommended.login = login;
    if (typeof raw.recommendedUser.exists === "boolean") {
      recommended.exists = raw.recommendedUser.exists;
    }
    if (Array.isArray(raw.recommendedUser.roles)) {
      const roles = raw.recommendedUser.roles
        .filter((role): role is string => typeof role === "string")
        .map((role) => clampString(role.trim(), MAX_STRING_LENGTH))
        .filter((role) => role !== "")
        .slice(0, MAX_RECOMMENDED_ROLES);
      if (roles.length > 0) recommended.roles = roles;
    }
    if (
      recommended.login !== undefined ||
      recommended.exists !== undefined ||
      recommended.roles !== undefined
    ) {
      result.recommendedUser = recommended;
    }
  }

  if (Array.isArray(raw.readiness)) {
    let droppedRows = 0;
    const rows: WordPressConnectionPackageReadinessRow[] = [];
    for (const entry of raw.readiness) {
      if (rows.length >= MAX_READINESS_ROWS) {
        droppedRows += 1;
        continue;
      }
      const row = parseReadinessRow(entry);
      if (row === null) {
        droppedRows += 1;
        continue;
      }
      rows.push(row);
    }
    if (rows.length > 0) result.readiness = rows;
    if (droppedRows > 0) {
      warnings.push(
        `Skipped ${droppedRows} unrecognized readiness ${droppedRows === 1 ? "row" : "rows"} in the package.`,
      );
    }
  }

  return { ok: true, package: result, warnings };
}

// ─── helpers ───────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a string field iff it's a non-empty string after trimming.
 * Returns `undefined` for missing / wrong-typed / empty values so
 * the caller can decide whether to omit the field entirely from
 * the whitelist output (we always do).
 */
function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return clampString(trimmed, MAX_STRING_LENGTH);
}

/**
 * Same as {@link readOptionalString} but also rejects non-http(s)
 * URLs. Anything that doesn't pass the URL regex is dropped so the
 * package can't smuggle a `javascript:` or `data:` link into the
 * dashboard via, say, the `adminUrl` field rendered as a link.
 */
function readOptionalUrl(value: unknown): string | undefined {
  const s = readOptionalString(value);
  if (s === undefined) return undefined;
  if (!URL_PATTERN.test(s)) return undefined;
  return clampString(s, MAX_URL_LENGTH);
}

function clampString(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function parseReadinessRow(
  entry: unknown,
): WordPressConnectionPackageReadinessRow | null {
  if (!isPlainObject(entry)) return null;
  const key = readOptionalString(entry.key);
  const label = readOptionalString(entry.label);
  const message = readOptionalString(entry.message);
  const status = entry.status;
  if (
    key === undefined ||
    label === undefined ||
    message === undefined ||
    typeof status !== "string" ||
    !isReadinessStatus(status)
  ) {
    return null;
  }
  return { key, label, status, message };
}

function isReadinessStatus(
  value: string,
): value is WordPressConnectionPackageReadinessStatus {
  return (
    WORDPRESS_CONNECTION_PACKAGE_READINESS_STATUSES as readonly string[]
  ).includes(value);
}

/**
 * Recursive walk: returns true the moment we spot a forbidden key.
 * Bounded by a small depth limit so a deeply-nested adversarial
 * payload can't blow the stack — 12 levels is plenty for our
 * known shape (5 levels) plus headroom.
 */
function containsForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsForbiddenKey(item, depth + 1)) return true;
    }
    return false;
  }
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(k)) return true;
    if (containsForbiddenKey(v, depth + 1)) return true;
  }
  return false;
}
