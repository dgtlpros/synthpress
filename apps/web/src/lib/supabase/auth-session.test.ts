import type { AuthError } from "@supabase/supabase-js";
import { describe, it, expect } from "vitest";
import { isStaleBrowserSessionError } from "./auth-session";

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
});
