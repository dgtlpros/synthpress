import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockGetUser = vi.fn();
const mockSignOut = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn().mockReturnValue({
    auth: { getUser: vi.fn(), signOut: vi.fn() },
  }),
}));

import { createServerClient } from "@supabase/ssr";
import { updateSession } from "./middleware";

const mockedCreateServerClient = vi.mocked(createServerClient);

beforeEach(() => {
  vi.clearAllMocks();

  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "test@example.com" } },
  });
  mockSignOut.mockResolvedValue({ error: null });

  mockedCreateServerClient.mockReturnValue({
    auth: { getUser: mockGetUser, signOut: mockSignOut },
  } as unknown as ReturnType<typeof createServerClient>);
});

function createMockRequest(url = "http://localhost:3000/dashboard") {
  return new NextRequest(new URL(url));
}

describe("updateSession", () => {
  it("returns user and response when authenticated", async () => {
    const request = createMockRequest();
    const { user, supabaseResponse } = await updateSession(request);

    expect(user).toEqual({ id: "user-1", email: "test@example.com" });
    expect(supabaseResponse).toBeInstanceOf(NextResponse);
  });

  it("returns null user when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const request = createMockRequest();
    const { user } = await updateSession(request);

    expect(user).toBeNull();
  });

  it("signs out and returns null when refresh token is stale", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: {
        name: "AuthApiError",
        message: "Invalid Refresh Token: Refresh Token Not Found",
        status: 400,
        code: "refresh_token_not_found",
      },
    });

    const request = createMockRequest();
    const { user } = await updateSession(request);

    expect(user).toBeNull();
    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  it("when resolveUser is false, skips auth calls (no getUser)", async () => {
    const request = createMockRequest("http://localhost:3000/");

    const { user } = await updateSession(request, { resolveUser: false });

    expect(user).toBeNull();
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("creates server client with cookie handlers", async () => {
    const request = createMockRequest();
    await updateSession(request);

    expect(mockedCreateServerClient).toHaveBeenCalledOnce();
    const args = mockedCreateServerClient.mock.calls[0];
    const cookieConfig = args[2] as {
      cookies: { getAll: () => unknown; setAll: (cookies: unknown[]) => void };
    };
    expect(cookieConfig.cookies.getAll).toBeTypeOf("function");
    expect(cookieConfig.cookies.setAll).toBeTypeOf("function");
  });

  it("getAll reads cookies from the request", async () => {
    const request = createMockRequest();
    await updateSession(request);

    const cookieConfig = mockedCreateServerClient.mock.calls[0][2] as {
      cookies: { getAll: () => unknown };
    };
    const cookies = cookieConfig.cookies.getAll();
    expect(Array.isArray(cookies)).toBe(true);
  });

  it("setAll writes cookies to request and creates new response", async () => {
    const request = createMockRequest();
    await updateSession(request);

    const config = mockedCreateServerClient.mock.calls[0][2] as unknown as {
      cookies: { setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void };
    };
    config.cookies.setAll([
      { name: "sb-token", value: "abc123", options: { path: "/", httpOnly: true } },
    ]);

    expect(request.cookies.get("sb-token")?.value).toBe("abc123");
  });
});
