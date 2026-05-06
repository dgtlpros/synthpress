import type { AuthError } from "@supabase/supabase-js";
import { describe, it, expect, vi } from "vitest";
import {
  isStaleBrowserSessionError,
  isStaleRefreshTokenLog,
  withSilencedStaleRefreshTokenLogs,
} from "./auth-session";

describe("isStaleBrowserSessionError", () => {
  it("returns true for refresh_token_not_found", () => {
    expect(
      isStaleBrowserSessionError({
        name: "AuthApiError",
        message: "Invalid Refresh Token: Refresh Token Not Found",
        status: 400,
        code: "refresh_token_not_found",
      } as AuthError),
    ).toBe(true);
  });

  it("returns true for invalid_refresh_token", () => {
    expect(
      isStaleBrowserSessionError({
        name: "AuthApiError",
        message: "Invalid Refresh Token",
        status: 400,
        code: "invalid_refresh_token",
      } as AuthError),
    ).toBe(true);
  });

  it("returns false for null/undefined", () => {
    expect(isStaleBrowserSessionError(null)).toBe(false);
    expect(isStaleBrowserSessionError(undefined)).toBe(false);
  });

  it("returns false for unrelated auth errors", () => {
    expect(
      isStaleBrowserSessionError({
        name: "AuthApiError",
        message: "JWT expired",
        status: 401,
        code: "session_expired",
      } as AuthError),
    ).toBe(false);
  });

  it("returns true via message fallback when code does not match (not found)", () => {
    expect(
      isStaleBrowserSessionError({
        name: "AuthApiError",
        message: "Invalid Refresh Token: Refresh Token Not Found",
        status: 400,
        code: "unexpected_failure",
      } as AuthError),
    ).toBe(true);
  });

  it("returns true via message fallback when code does not match (invalid)", () => {
    expect(
      isStaleBrowserSessionError({
        name: "AuthApiError",
        message: "invalid refresh token",
        status: 400,
        code: "unexpected_failure",
      } as AuthError),
    ).toBe(true);
  });

  it("returns false when message is not a string", () => {
    expect(
      isStaleBrowserSessionError({
        name: "AuthApiError",
        message: undefined,
        status: 400,
        code: "unexpected_failure",
      } as unknown as AuthError),
    ).toBe(false);
  });
});

describe("isStaleRefreshTokenLog", () => {
  it("matches the shape Supabase passes to console.error", () => {
    expect(
      isStaleRefreshTokenLog({
        __isAuthError: true,
        code: "refresh_token_not_found",
        message: "Invalid Refresh Token: Refresh Token Not Found",
        status: 400,
      }),
    ).toBe(true);
  });

  it("matches by message when code is missing", () => {
    expect(
      isStaleRefreshTokenLog({
        __isAuthError: true,
        message: "Invalid Refresh Token",
      }),
    ).toBe(true);
  });

  it("ignores values that are not auth errors", () => {
    expect(isStaleRefreshTokenLog("a string")).toBe(false);
    expect(isStaleRefreshTokenLog({ message: "Invalid Refresh Token" })).toBe(false);
    expect(isStaleRefreshTokenLog(null)).toBe(false);
  });

  it("returns false when code does not match and message is not a string", () => {
    expect(
      isStaleRefreshTokenLog({
        __isAuthError: true,
        code: "something_else",
        message: 42,
      }),
    ).toBe(false);
  });
});

describe("withSilencedStaleRefreshTokenLogs", () => {
  it("filters only stale-refresh-token logs", async () => {
    const original = console.error;
    const spy = vi.fn();
    console.error = spy;

    await withSilencedStaleRefreshTokenLogs(async () => {
      console.error({
        __isAuthError: true,
        code: "refresh_token_not_found",
        message: "Invalid Refresh Token: Refresh Token Not Found",
        status: 400,
      });
      console.error("keep me");
    });

    console.error = original;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("keep me");
  });

  it("restores console.error if the wrapped function throws", async () => {
    const original = console.error;
    const spy = vi.fn();
    console.error = spy;

    await expect(
      withSilencedStaleRefreshTokenLogs(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(console.error).toBe(spy);
    console.error = original;
  });
});
