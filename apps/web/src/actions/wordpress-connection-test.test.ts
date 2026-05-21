import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/services/wordpress-connection-test-service", () => ({
  testWordPressConnection: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { testWordPressConnection } from "@/services/wordpress-connection-test-service";
import { testBlogWordPressConnection } from "./wordpress-connection-test";

const mockedCreateClient = vi.mocked(createClient);
const mockedTest = vi.mocked(testWordPressConnection);

interface BlogRow {
  wp_url: string | null;
  wp_username: string | null;
  wp_app_password: string | null;
}

function mockSupabase(
  blogRow: BlogRow | null,
  user: { id: string } | null = { id: "u1" },
  loadError: { message: string } | null = null,
) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: blogRow,
                error: loadError,
              }),
          }),
        }),
      }),
    }),
  } as never);
}

const baseInput = { teamId: "t1", projectId: "p1", blogId: "b1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testBlogWordPressConnection", () => {
  it("returns an auth error when there is no signed-in user", async () => {
    mockSupabase(null, null);
    const result = await testBlogWordPressConnection(baseInput);
    expect(result.error).toMatch(/signed in/);
    expect(mockedTest).not.toHaveBeenCalled();
  });

  it("returns Blog not found when the row is hidden by RLS", async () => {
    mockSupabase(null);
    const result = await testBlogWordPressConnection(baseInput);
    expect(result.error).toBe("Blog not found.");
    expect(mockedTest).not.toHaveBeenCalled();
  });

  it("returns the Supabase error message when the row read fails", async () => {
    mockSupabase(null, { id: "u1" }, { message: "db down" });
    const result = await testBlogWordPressConnection(baseInput);
    expect(result.error).toBe("db down");
    expect(mockedTest).not.toHaveBeenCalled();
  });

  it("calls the helper with the stored credentials", async () => {
    mockSupabase({
      wp_url: "https://example.com",
      wp_username: "alice",
      wp_app_password: "abcd 1234 efgh 5678",
    });
    mockedTest.mockResolvedValue({
      ok: true,
      siteUrl: "https://example.com",
      user: { id: 1, name: "Alice" },
      capabilities: {},
      warnings: [],
    });
    const result = await testBlogWordPressConnection(baseInput);
    expect(mockedTest).toHaveBeenCalledWith({
      wpUrl: "https://example.com",
      username: "alice",
      appPassword: "abcd 1234 efgh 5678",
    });
    expect(result.data?.ok).toBe(true);
  });

  it("propagates a successful helper result unchanged (sans password)", async () => {
    mockSupabase({
      wp_url: "https://example.com",
      wp_username: "alice",
      wp_app_password: "secret",
    });
    const helperResult = {
      ok: true as const,
      siteUrl: "https://example.com",
      user: {
        id: 1,
        name: "Alice",
        slug: "alice",
        roles: ["administrator"],
      },
      capabilities: {
        canCreatePosts: true,
        canPublishPosts: true,
        canUploadMedia: true,
        canCreateTerms: true,
      },
      warnings: [],
    };
    mockedTest.mockResolvedValue(helperResult);
    const result = await testBlogWordPressConnection(baseInput);
    expect(result.data).toEqual(helperResult);
    // The wire object MUST NOT contain the app password.
    expect(JSON.stringify(result)).not.toMatch(/secret/);
  });

  it("propagates helper failure results (e.g. unauthorized)", async () => {
    mockSupabase({
      wp_url: "https://example.com",
      wp_username: "alice",
      wp_app_password: "wrong",
    });
    mockedTest.mockResolvedValue({
      ok: false,
      siteUrl: "https://example.com",
      warnings: [],
      error: {
        code: "unauthorized",
        message: "WordPress rejected these credentials.",
      },
    });
    const result = await testBlogWordPressConnection(baseInput);
    expect(result.data?.ok).toBe(false);
    expect(result.data?.error?.code).toBe("unauthorized");
  });

  it("forwards empty credentials to the helper (helper produces missing_* errors)", async () => {
    mockSupabase({
      wp_url: null,
      wp_username: null,
      wp_app_password: null,
    });
    mockedTest.mockResolvedValue({
      ok: false,
      siteUrl: "",
      warnings: [],
      error: { code: "missing_url", message: "Enter your WordPress site URL." },
    });
    const result = await testBlogWordPressConnection(baseInput);
    expect(mockedTest).toHaveBeenCalledWith({
      wpUrl: "",
      username: "",
      appPassword: "",
    });
    expect(result.data?.error?.code).toBe("missing_url");
  });

  it("never echoes the app password back in the returned object", async () => {
    mockSupabase({
      wp_url: "https://example.com",
      wp_username: "alice",
      wp_app_password: "super-secret-password",
    });
    mockedTest.mockResolvedValue({
      ok: true,
      siteUrl: "https://example.com",
      user: { id: 1 },
      capabilities: {},
      warnings: [],
    });
    const result = await testBlogWordPressConnection(baseInput);
    expect(JSON.stringify(result)).not.toMatch(/super-secret-password/);
  });
});
