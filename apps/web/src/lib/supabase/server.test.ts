import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";
import { after } from "next/server";
import {
  createClient,
  getAuthUserOncePerResponse,
  resetAuthUserDedupeForTests,
} from "./server";

const mockedCreateServerClient = vi.mocked(createServerClient);

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthUserDedupeForTests();
  mockGetAll.mockReturnValue([{ name: "sb-token", value: "abc" }]);
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockSignOut.mockResolvedValue({ error: null });
  mockedCreateServerClient.mockReturnValue({
    auth: { getUser: mockGetUser, signOut: mockSignOut },
  } as unknown as ReturnType<typeof createServerClient>);
});

afterEach(() => {
  resetAuthUserDedupeForTests();
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
      cookies: {
        setAll: (
          cookies: {
            name: string;
            value: string;
            options: Record<string, unknown>;
          }[],
        ) => void;
      };
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
      cookies: {
        setAll: (
          cookies: {
            name: string;
            value: string;
            options: Record<string, unknown>;
          }[],
        ) => void;
      };
    };
    expect(() =>
      config.cookies.setAll([{ name: "sb-token", value: "abc", options: {} }]),
    ).not.toThrow();
  });

  it("getAuthUserOncePerResponse dedupes concurrent calls", async () => {
    await Promise.all([
      getAuthUserOncePerResponse(),
      getAuthUserOncePerResponse(),
    ]);

    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(vi.mocked(after)).toHaveBeenCalledOnce();
  });

  it("getAuthUserOncePerResponse dedupes sequential calls before after clears the map", async () => {
    await getAuthUserOncePerResponse();
    await getAuthUserOncePerResponse();

    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it("getAuthUserOncePerResponse skips Supabase entirely when no sb-* cookies are present", async () => {
    mockGetAll.mockReturnValue([{ name: "session", value: "abc" }]);

    const out = await getAuthUserOncePerResponse();

    expect(out).toEqual({ data: { user: null }, error: null });
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockedCreateServerClient).not.toHaveBeenCalled();
    expect(vi.mocked(after)).not.toHaveBeenCalled();
  });

  it("dedup key sort comparator fires with multiple sb-* cookies", async () => {
    mockGetAll.mockReturnValue([
      { name: "sb-token-b", value: "bbb" },
      { name: "sb-token-a", value: "aaa" },
    ]);

    await getAuthUserOncePerResponse();
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it("after callback clears the dedupe entry", async () => {
    await getAuthUserOncePerResponse();
    expect(mockGetUser).toHaveBeenCalledTimes(1);

    const afterCb = vi.mocked(after).mock.calls[0][0] as () => void;
    afterCb();

    await getAuthUserOncePerResponse();
    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });

  it("getAuthUserOncePerResponse silences Supabase's refresh_token_not_found console.error", async () => {
    const originalError = console.error;
    const errorSpy = vi.fn();
    console.error = errorSpy;

    mockGetUser.mockImplementation(async () => {
      console.error({
        __isAuthError: true,
        code: "refresh_token_not_found",
        message: "Invalid Refresh Token: Refresh Token Not Found",
        status: 400,
      });
      console.error("an unrelated message");
      return { data: { user: null }, error: null };
    });

    await getAuthUserOncePerResponse();

    console.error = originalError;

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("an unrelated message");
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
