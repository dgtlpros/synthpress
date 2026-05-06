import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetAll, mockSet, mockGetUser, mockSignOut } = vi.hoisted(() => ({
  mockGetAll: vi.fn().mockReturnValue([]),
  mockSet: vi.fn(),
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: mockGetAll,
    set: mockSet,
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn().mockReturnValue({
    auth: { getUser: vi.fn(), signOut: vi.fn() },
  }),
}));

import { createServerClient } from "@supabase/ssr";
import { createClient } from "./server";

const mockedCreateServerClient = vi.mocked(createServerClient);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockSignOut.mockResolvedValue({ error: null });
  mockedCreateServerClient.mockReturnValue({
    auth: { getUser: mockGetUser, signOut: mockSignOut },
  } as unknown as ReturnType<typeof createServerClient>);
});

describe("createClient (server)", () => {
  it("creates a server client with cookie handlers", async () => {
    const client = await createClient();

    expect(mockedCreateServerClient).toHaveBeenCalledOnce();
    expect(client.auth.getUser).toBeTypeOf("function");
    expect(client.auth.signOut).toBe(mockSignOut);
  });

  it("passes cookie getAll and setAll handlers", async () => {
    await createClient();

    const cookieConfig = mockedCreateServerClient.mock.calls[0][2] as {
      cookies: { getAll: () => unknown; setAll: (cookies: unknown[]) => void };
    };
    expect(cookieConfig.cookies.getAll).toBeTypeOf("function");
    expect(cookieConfig.cookies.setAll).toBeTypeOf("function");
  });

  it("getAll reads from cookie store", async () => {
    await createClient();

    const cookieConfig = mockedCreateServerClient.mock.calls[0][2] as {
      cookies: { getAll: () => unknown };
    };
    mockGetAll.mockReturnValue([{ name: "sb-token", value: "abc" }]);

    const result = cookieConfig.cookies.getAll();
    expect(result).toEqual([{ name: "sb-token", value: "abc" }]);
  });

  it("setAll writes to cookie store", async () => {
    await createClient();

    const config = mockedCreateServerClient.mock.calls[0][2] as unknown as {
      cookies: { setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void };
    };
    config.cookies.setAll([
      { name: "sb-token", value: "abc", options: { path: "/" } },
    ]);

    expect(mockSet).toHaveBeenCalledWith("sb-token", "abc", { path: "/" });
  });

  it("setAll silently catches errors in read-only contexts", async () => {
    mockSet.mockImplementation(() => {
      throw new Error("Cannot set cookies in Server Component");
    });

    await createClient();

    const config = mockedCreateServerClient.mock.calls[0][2] as unknown as {
      cookies: { setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void };
    };
    expect(() =>
      config.cookies.setAll([
        { name: "sb-token", value: "abc", options: {} },
      ]),
    ).not.toThrow();
  });

  it("getUser signs out and returns null user when refresh token is stale", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: {
        name: "AuthApiError",
        message: "Invalid Refresh Token: Refresh Token Not Found",
        status: 400,
        code: "refresh_token_not_found",
      },
    });

    const client = await createClient();
    const out = await client.auth.getUser();

    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(out.data.user).toBeNull();
    expect(out.error).toBeNull();
  });
});
