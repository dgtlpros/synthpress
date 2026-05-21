import "server-only";

import type { BlogPublishingSettings } from "@/lib/blog-settings";

/**
 * Resolves blog-level publishing defaults into WordPress REST post
 * fields (`categories`, `tags`, `author`). Best-effort: a failed
 * lookup/create for one field does not block the others or the
 * publish itself — unresolved fields are simply omitted from the
 * payload.
 */

export interface ResolvePublishingMetaInput {
  wpUrl: string;
  auth: string;
  publishing: BlogPublishingSettings;
  fetchImpl?: typeof fetch;
}

export interface ResolvedPublishingMeta {
  categoryIds: number[];
  tagIds: number[];
  authorId: number | null;
}

function trimSiteUrl(siteUrl: string): string {
  return siteUrl.trim().replace(/\/+$/, "");
}

export function buildWordPressCategoriesEndpoint(
  siteUrl: string,
  categoryId?: number,
): string {
  const base = `${trimSiteUrl(siteUrl)}/wp-json/wp/v2/categories`;
  return categoryId ? `${base}/${categoryId}` : base;
}

export function buildWordPressTagsEndpoint(
  siteUrl: string,
  tagId?: number,
): string {
  const base = `${trimSiteUrl(siteUrl)}/wp-json/wp/v2/tags`;
  return tagId ? `${base}/${tagId}` : base;
}

export function buildWordPressUsersEndpoint(
  siteUrl: string,
  userId?: number,
): string {
  const base = `${trimSiteUrl(siteUrl)}/wp-json/wp/v2/users`;
  return userId ? `${base}/${userId}` : base;
}

function jsonAuthHeaders(auth: string): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: auth,
    "Content-Type": "application/json",
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

async function fetchJsonArray(
  url: string,
  auth: string,
  fetchImpl: typeof fetch,
): Promise<unknown[] | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json", Authorization: auth },
    });
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function createTaxonomyTerm(
  endpoint: string,
  name: string,
  auth: string,
  fetchImpl: typeof fetch,
): Promise<number | null> {
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: jsonAuthHeaders(auth),
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      isPositiveInteger((parsed as { id?: unknown }).id)
    ) {
      return (parsed as { id: number }).id;
    }
    return null;
  } catch {
    return null;
  }
}

function findTaxonomyMatch(items: unknown[], name: string): number | null {
  const lower = name.toLowerCase();
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as { id?: unknown; name?: unknown; slug?: unknown };
    if (!isPositiveInteger(row.id)) continue;
    const slug = typeof row.slug === "string" ? row.slug.toLowerCase() : "";
    const label = typeof row.name === "string" ? row.name.toLowerCase() : "";
    if (slug === lower || label === lower) return row.id;
  }
  return null;
}

/**
 * Resolves a category name to a WordPress category id (search, then
 * create). Returns `null` when the name is empty or resolution fails.
 */
export async function resolveWordPressCategoryId(
  name: string,
  wpUrl: string,
  auth: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const searchUrl = `${buildWordPressCategoriesEndpoint(wpUrl)}?search=${encodeURIComponent(trimmed)}&per_page=100`;
  const items = await fetchJsonArray(searchUrl, auth, fetchImpl);
  if (items) {
    const existing = findTaxonomyMatch(items, trimmed);
    if (existing !== null) return existing;
  }

  return createTaxonomyTerm(
    buildWordPressCategoriesEndpoint(wpUrl),
    trimmed,
    auth,
    fetchImpl,
  );
}

/**
 * Resolves tag names to WordPress tag ids (search per tag, create if
 * missing). Skips empty strings and tags that fail to resolve.
 */
export async function resolveWordPressTagIds(
  names: readonly string[],
  wpUrl: string,
  auth: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<number[]> {
  const out: number[] = [];
  const seen = new Set<number>();

  for (const raw of names) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const searchUrl = `${buildWordPressTagsEndpoint(wpUrl)}?search=${encodeURIComponent(trimmed)}&per_page=100`;
    const items = await fetchJsonArray(searchUrl, auth, fetchImpl);
    let id: number | null = null;
    if (items) {
      id = findTaxonomyMatch(items, trimmed);
    }
    if (id === null) {
      id = await createTaxonomyTerm(
        buildWordPressTagsEndpoint(wpUrl),
        trimmed,
        auth,
        fetchImpl,
      );
    }
    if (id !== null && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }

  return out;
}

/**
 * Resolves a WordPress user id from login/slug (preferred) or search.
 */
export async function resolveWordPressAuthorId(
  login: string,
  wpUrl: string,
  auth: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<number | null> {
  const trimmed = login.trim();
  if (!trimmed) return null;

  const slugUrl = `${buildWordPressUsersEndpoint(wpUrl)}?slug=${encodeURIComponent(trimmed)}`;
  const bySlug = await fetchJsonArray(slugUrl, auth, fetchImpl);
  if (bySlug && bySlug.length > 0) {
    const first = bySlug[0];
    if (
      typeof first === "object" &&
      first !== null &&
      isPositiveInteger((first as { id?: unknown }).id)
    ) {
      return (first as { id: number }).id;
    }
  }

  const searchUrl = `${buildWordPressUsersEndpoint(wpUrl)}?search=${encodeURIComponent(trimmed)}&per_page=100`;
  const items = await fetchJsonArray(searchUrl, auth, fetchImpl);
  if (!items) return null;

  const lower = trimmed.toLowerCase();
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as { id?: unknown; slug?: unknown; name?: unknown };
    if (!isPositiveInteger(row.id)) continue;
    const slug = typeof row.slug === "string" ? row.slug.toLowerCase() : "";
    const name = typeof row.name === "string" ? row.name.toLowerCase() : "";
    if (slug === lower || name === lower) return row.id;
  }

  return null;
}

/**
 * Resolves all wired publishing defaults for a single post sync.
 */
export async function resolvePublishingMetaForPost(
  input: ResolvePublishingMetaInput,
): Promise<ResolvedPublishingMeta> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const { wpUrl, auth, publishing } = input;

  const [categoryId, tagIds, authorId] = await Promise.all([
    publishing.defaultCategory.trim()
      ? resolveWordPressCategoryId(
          publishing.defaultCategory,
          wpUrl,
          auth,
          fetchImpl,
        )
      : Promise.resolve(null),
    publishing.defaultTags.length > 0
      ? resolveWordPressTagIds(publishing.defaultTags, wpUrl, auth, fetchImpl)
      : Promise.resolve([]),
    publishing.defaultAuthor.trim()
      ? resolveWordPressAuthorId(
          publishing.defaultAuthor,
          wpUrl,
          auth,
          fetchImpl,
        )
      : Promise.resolve(null),
  ]);

  return {
    categoryIds: categoryId !== null ? [categoryId] : [],
    tagIds,
    authorId,
  };
}
