import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn().mockReturnValue({ auth: {} }),
}));

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./admin";

const mockedCreate = vi.mocked(createSupabaseClient);
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("createAdminClient", () => {
  it("creates a Supabase client with the service role key and disabled session persistence", () => {
    createAdminClient();

    expect(mockedCreate).toHaveBeenCalledWith(
      "http://localhost:54321",
      "service-role-key",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => createAdminClient()).toThrow(
      /Missing Supabase admin env vars/,
    );
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createAdminClient()).toThrow(
      /Missing Supabase admin env vars/,
    );
  });
});
