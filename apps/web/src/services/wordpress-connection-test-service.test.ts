import { describe, expect, it, vi } from "vitest";

import { testWordPressConnection } from "./wordpress-connection-test-service";

function jsonResponse(
  status: number,
  body: unknown,
  init?: { statusText?: string },
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: init?.statusText ?? "",
    headers: { "Content-Type": "application/json" },
  });
}

// Typed alias for `vi.fn<typeof fetch>` so `mock.calls[0]` carries
// the [url, init] tuple shape rather than the no-args `[]` default
// that an untyped `vi.fn(async () => ...)` would infer.
function mockFetch(
  impl: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  return vi.fn(impl);
}

describe("testWordPressConnection", () => {
  it("returns missing_url when wpUrl is empty", async () => {
    const fetchImpl = vi.fn();
    const result = await testWordPressConnection({
      wpUrl: "  ",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("missing_url");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns missing_username when username is empty", async () => {
    const fetchImpl = vi.fn();
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: " ",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("missing_username");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns missing_password when app password is empty", async () => {
    const fetchImpl = vi.fn();
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "   ",
      fetchImpl,
    });
    expect(result.error?.code).toBe("missing_password");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns invalid_url for a malformed URL", async () => {
    const fetchImpl = vi.fn();
    const result = await testWordPressConnection({
      wpUrl: "example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("invalid_url");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns invalid_url for non-http(s) protocols", async () => {
    const fetchImpl = vi.fn();
    const result = await testWordPressConnection({
      wpUrl: "ftp://example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("invalid_url");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls /wp/v2/users/me with Basic Auth and context=edit", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, {
        id: 1,
        name: "Alice",
        slug: "alice",
        roles: ["administrator"],
        capabilities: {
          edit_posts: true,
          publish_posts: true,
          upload_files: true,
          manage_categories: true,
        },
      }),
    );
    await testWordPressConnection({
      wpUrl: "https://example.com/",
      username: "alice",
      appPassword: "abcd 1234 efgh 5678",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe(
      "https://example.com/wp-json/wp/v2/users/me?context=edit",
    );
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Accept).toBe("application/json");
    // App password whitespace stripped → base64("alice:abcd1234efgh5678")
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("alice:abcd1234efgh5678").toString("base64")}`,
    );
  });

  it("maps a successful response to user + capability data", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: 42,
        name: "Alice Author",
        slug: "alice",
        roles: ["author"],
        capabilities: {
          edit_posts: true,
          publish_posts: true,
          upload_files: true,
          manage_categories: false,
        },
      }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.siteUrl).toBe("https://example.com");
    expect(result.user).toEqual({
      id: 42,
      name: "Alice Author",
      slug: "alice",
      roles: ["author"],
    });
    expect(result.capabilities).toEqual({
      canCreatePosts: true,
      canPublishPosts: true,
      canUploadMedia: true,
      canCreateTerms: false,
    });
    expect(result.warnings).toEqual([
      "Connected, but this user may not be able to create new categories or tags. Use existing ones when configuring publishing defaults.",
    ]);
  });

  it("emits a warning when canUploadMedia is false", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: 5,
        name: "Bob",
        slug: "bob",
        roles: ["contributor"],
        capabilities: {
          edit_posts: true,
          publish_posts: false,
          upload_files: false,
          manage_categories: false,
        },
      }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "bob",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      "Connected, but this user can only create drafts — they cannot publish posts. Drafts will still be sent successfully.",
      "Connected, but this user may not be able to upload media. Featured images won't be sent to WordPress.",
      "Connected, but this user may not be able to create new categories or tags. Use existing ones when configuring publishing defaults.",
    ]);
  });

  it("warns the user when they cannot create posts at all", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: 7,
        roles: ["subscriber"],
        capabilities: {
          edit_posts: false,
          publish_posts: false,
          upload_files: false,
          manage_categories: false,
        },
      }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "sub",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toMatch(/cannot create posts/);
    // Should NOT also say "can only create drafts" — that would be
    // contradictory.
    expect(result.warnings.join("\n")).not.toMatch(/can only create drafts/);
  });

  it("falls back to role-based capabilities when capabilities block is absent", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: 1,
        name: "Admin",
        slug: "admin",
        roles: ["administrator"],
      }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "admin",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual({
      canCreatePosts: true,
      canPublishPosts: true,
      canUploadMedia: true,
      canCreateTerms: true,
    });
    expect(result.warnings).toEqual([]);
  });

  it("derives a 'create drafts but cannot publish/upload' shape from a contributor role when capabilities block is absent", async () => {
    // Hits the `next === false && existing === undefined` branch in
    // the role heuristic — contributor explicitly maps several caps
    // to false (vs. administrator which only maps trues).
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: 11,
        name: "Conn",
        roles: ["contributor"],
        // No `capabilities` block → forces the role fallback.
      }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "conn",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual({
      canCreatePosts: true,
      canPublishPosts: false,
      canUploadMedia: false,
      canCreateTerms: false,
    });
    // Branch coverage byproduct: warnings stack correctly when the
    // role-derived map is all-false-but-create.
    expect(result.warnings.join("\n")).toMatch(/can only create drafts/);
    expect(result.warnings.join("\n")).toMatch(/upload media/);
    expect(result.warnings.join("\n")).toMatch(/categories or tags/);
  });

  it("lets a later granting role override an earlier role's false (any-true-wins)", async () => {
    // contributor sets canPublishPosts = false, then administrator
    // arrives and flips it to true. The merge order matters because
    // the `next === true` branch must clobber an earlier `false`.
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: 12,
        name: "Both",
        roles: ["contributor", "administrator"],
      }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "both",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual({
      canCreatePosts: true,
      canPublishPosts: true,
      canUploadMedia: true,
      canCreateTerms: true,
    });
    expect(result.warnings).toEqual([]);
  });

  it("treats undefined wpUrl / username / appPassword the same as empty strings (returns the right missing_* code)", async () => {
    // Branch coverage for the `?? ""` fallbacks in the input
    // normalization preamble — callers can omit fields entirely and
    // the function should map them to the same error codes as
    // empty-string values, not crash on `undefined.trim()`.
    const fetchImpl = vi.fn();
    const missingUrl = await testWordPressConnection({
      wpUrl: undefined as unknown as string,
      username: "u",
      appPassword: "p",
      fetchImpl,
    });
    expect(missingUrl.error?.code).toBe("missing_url");

    const missingUsername = await testWordPressConnection({
      wpUrl: "https://x.com",
      username: undefined as unknown as string,
      appPassword: "p",
      fetchImpl,
    });
    expect(missingUsername.error?.code).toBe("missing_username");

    const missingPassword = await testWordPressConnection({
      wpUrl: "https://x.com",
      username: "u",
      appPassword: undefined as unknown as string,
      fetchImpl,
    });
    expect(missingPassword.error?.code).toBe("missing_password");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to globalThis.fetch when no fetchImpl is injected", async () => {
    // Branch coverage for `input.fetchImpl ?? globalThis.fetch`.
    // We stub the real `fetch` for one call rather than threading a
    // mock through, so we exercise the `??` fallback path.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(200, {
        id: 1,
        name: "Real",
        roles: ["administrator"],
      }) as Response,
    );
    try {
      const result = await testWordPressConnection({
        wpUrl: "https://example.com",
        username: "u",
        appPassword: "p",
      });
      expect(result.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // Confirm we hit the canonical WP REST endpoint via the
      // global fetch path, not some other URL.
      expect(fetchSpy.mock.calls[0]![0]).toBe(
        "https://example.com/wp-json/wp/v2/users/me?context=edit",
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("normalizes empty-string user fields and an empty roles array out of the response (treats them as 'missing')", async () => {
    // Branch coverage for pickString + pickStringArray: an empty
    // string `name` / `slug` and an empty `roles` array should be
    // treated the same as missing, not echoed back as "".
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: 1,
        name: "",
        slug: "",
        roles: [],
        capabilities: {
          edit_posts: true,
          publish_posts: true,
          upload_files: true,
          manage_categories: true,
        },
      }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "x",
      appPassword: "p",
      fetchImpl,
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.user?.name).toBeUndefined();
    expect(result.user?.slug).toBeUndefined();
    expect(result.user?.roles).toBeUndefined();
  });

  it("ignores non-boolean capability values in the capabilities block (defensive)", async () => {
    // A misbehaving WP plugin might stuff non-boolean values into
    // the capabilities map (string, number, null). Each entry that
    // isn't a real boolean must be dropped, leaving the rest intact.
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: 1,
        name: "Mix",
        roles: ["administrator"],
        capabilities: {
          edit_posts: true,
          publish_posts: "yes",
          upload_files: 1,
          manage_categories: null,
        },
      }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "x",
      appPassword: "p",
      fetchImpl,
    });
    if (!result.ok) throw new Error("expected ok");
    // Only the real boolean survived.
    expect(result.capabilities).toEqual({ canCreatePosts: true });
  });

  it("preserves an earlier role's 'true' even when a later role explicitly maps the same capability to false", async () => {
    // Order matters in the role merge — administrator first sets
    // canPublishPosts/canUploadMedia/canCreateTerms to true; the
    // contributor that follows must NOT overwrite them with false.
    // (Hits the `next === false && existing !== undefined` branch
    // — the else-if condition evaluates false and we no-op.)
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: 13,
        name: "Order",
        roles: ["administrator", "contributor"],
      }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "order",
      appPassword: "p",
      fetchImpl,
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.capabilities).toEqual({
      canCreatePosts: true,
      canPublishPosts: true,
      canUploadMedia: true,
      canCreateTerms: true,
    });
    expect(result.warnings).toEqual([]);
  });

  it("returns empty capabilities for unknown roles (no false positives)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: 99,
        name: "Custom",
        roles: ["custom_role_x"],
      }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "x",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it("maps 401 to the friendly credential error", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 401, statusText: "Unauthorized" }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "wrong",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unauthorized");
    expect(result.error?.message).toMatch(/rejected these credentials/);
  });

  it("maps 403 to the forbidden error", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 403, statusText: "Forbidden" }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("forbidden");
  });

  it("maps 404 to the REST/wrong-URL error", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 404, statusText: "Not Found" }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("rest_not_found");
    expect(result.error?.message).toMatch(/REST API could not be reached/);
  });

  it("maps a generic non-OK response to unexpected with the status code", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 500, statusText: "Server Error" }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("unexpected");
    expect(result.error?.message).toMatch(/HTTP 500/);
  });

  it("maps a thrown fetch error to network_error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("network_error");
    // Underlying message must NOT leak through.
    expect(result.error?.message).not.toMatch(/fetch failed/);
  });

  it("maps an unparseable response body to invalid_json", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>not json</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("invalid_json");
  });

  it("maps a 200 with no id field to not_wordpress", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { hello: "world" }));
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("not_wordpress");
  });

  it("maps a 200 with a non-integer id to not_wordpress", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { id: "abc" }));
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("not_wordpress");
  });

  it("maps a 200 array response to not_wordpress", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [{ id: 1 }]));
    const result = await testWordPressConnection({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.error?.code).toBe("not_wordpress");
  });

  it("normalizes trailing slashes on the site URL", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, { id: 1, name: "Alice" }),
    );
    const result = await testWordPressConnection({
      wpUrl: "https://example.com///",
      username: "alice",
      appPassword: "p",
      fetchImpl,
    });
    expect(result.siteUrl).toBe("https://example.com");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://example.com/wp-json/wp/v2/users/me?context=edit",
    );
  });
});
