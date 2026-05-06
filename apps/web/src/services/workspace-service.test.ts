import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  slugify,
  generateUniqueTeamSlug,
  generateUniqueProjectSlug,
  generateUniqueBlogSlug,
} from "./workspace-service";

function mockMaybeSingleOnce(data: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World", "fb")).toBe("hello-world");
  });

  it("strips unsafe characters", () => {
    expect(slugify("Foo!!! Bar***", "fb")).toBe("foo-bar");
  });

  it("uses fallback when result empty", () => {
    expect(slugify("!!!", "fallback")).toBe("fallback");
  });
});

describe("generateUniqueTeamSlug", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("returns base slug when unused", async () => {
    const client = mockMaybeSingleOnce(null);
    await expect(generateUniqueTeamSlug("My Team", client)).resolves.toBe("my-team");
  });

  it("suffixes when slug exists", async () => {
    let call = 0;
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockImplementation(() => {
              call += 1;
              return Promise.resolve({
                data: call === 1 ? { id: "existing" } : null,
                error: null,
              });
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(generateUniqueTeamSlug("My Team", client)).resolves.toMatch(/^my-team-aaaaaaaa$/);
  });
});

describe("generateUniqueProjectSlug", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("returns base slug when unused inside team", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          })),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(generateUniqueProjectSlug("tid", "Alpha", client)).resolves.toBe("alpha");
  });
});

describe("generateUniqueBlogSlug", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("returns base slug when unused inside project", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          })),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(generateUniqueBlogSlug("pid", "News blog", client)).resolves.toBe("news-blog");
  });
});
