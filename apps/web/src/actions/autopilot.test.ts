import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/services/team-policy-service", () => {
  class TeamPermissionError extends Error {
    code: "not_a_member" | "forbidden";
    action: string;
    role: string | null;
    constructor(
      code: "not_a_member" | "forbidden",
      action: string,
      role: string | null,
    ) {
      super(`Forbidden: cannot ${action}`);
      this.code = code;
      this.action = action;
      this.role = role;
    }
  }
  return {
    assertCan: vi.fn(),
    TeamPermissionError,
  };
});

vi.mock("@/services/autopilot-scheduler-service", () => ({
  runAutopilotForBlog: vi.fn(),
}));

vi.mock("@/services/blog-autopilot-run-service", () => ({
  getBlogAutopilotRunDetail: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCan, TeamPermissionError } from "@/services/team-policy-service";
import { runAutopilotForBlog } from "@/services/autopilot-scheduler-service";
import { getBlogAutopilotRunDetail } from "@/services/blog-autopilot-run-service";
import {
  AUTOPILOT_ACTION_ERRORS,
  getAutopilotRunDetail,
  runAutopilotNow,
} from "./autopilot";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdmin = vi.mocked(createAdminClient);
const mockedAssertCan = vi.mocked(assertCan);
const mockedRunAutopilot = vi.mocked(runAutopilotForBlog);
const mockedRevalidatePath = vi.mocked(revalidatePath);
const mockedGetDetail = vi.mocked(getBlogAutopilotRunDetail);

function makeAuthedClient(user: { id: string } | null = { id: "u1" }) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

interface BlogChain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
}

/**
 * Wires the admin client's `from("blogs")` lookup. The action loads
 * `id, settings` to gate on `mode='autopilot' AND enabled=true`, so
 * tests that exercise that gate need to control the returned settings.
 */
function makeAdminWithBlog(
  blog: { id: string; settings: Record<string, unknown> } | null,
): { client: { from: ReturnType<typeof vi.fn> }; chain: BlogChain } {
  const chain: BlogChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: blog, error: null }),
  };
  return { client: { from: vi.fn(() => chain) }, chain };
}

const ENABLED_AUTOPILOT_SETTINGS = {
  automation: { mode: "autopilot", enabled: true },
};
const DISABLED_AUTOPILOT_SETTINGS = {
  automation: { mode: "autopilot", enabled: false },
};
const MANUAL_SETTINGS = {
  automation: { mode: "manual", enabled: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(makeAuthedClient() as never);
  mockedCreateAdmin.mockReturnValue({} as never);
  mockedAssertCan.mockResolvedValue("admin");
  mockedRunAutopilot.mockResolvedValue({
    runId: "run-1",
    status: "completed",
    reason: null,
    ideasGenerated: 2,
    articleJobsStarted: 1,
    articleJobIds: ["job-1"],
    output: {},
  });
});

describe("runAutopilotNow — auth + permissions", () => {
  it("rejects calls without a blog id", async () => {
    const result = await runAutopilotNow("t1", "p1", "");
    expect(result.error).toMatch(/Blog id is required/);
    expect(mockedRunAutopilot).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValueOnce(makeAuthedClient(null) as never);

    const result = await runAutopilotNow("t1", "p1", "b1");
    expect(result.error).toBe(AUTOPILOT_ACTION_ERRORS.not_signed_in);
    expect(mockedAssertCan).not.toHaveBeenCalled();
    expect(mockedRunAutopilot).not.toHaveBeenCalled();
  });

  it("checks manage_blog permission before doing any work", async () => {
    const { client } = makeAdminWithBlog({
      id: "b1",
      settings: ENABLED_AUTOPILOT_SETTINGS,
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    await runAutopilotNow("t1", "p1", "b1");

    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "manage_blog",
      expect.anything(),
    );
  });

  it("returns the TeamPermissionError code when the caller can't manage the blog", async () => {
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError("forbidden", "manage_blog", "member" as never),
    );

    const result = await runAutopilotNow("t1", "p1", "b1");
    expect(result.error).toBe("forbidden");
    expect(mockedRunAutopilot).not.toHaveBeenCalled();
  });
});

describe("runAutopilotNow — blog + autopilot gating", () => {
  it("returns blog_not_found when the blog isn't in this project", async () => {
    const { client } = makeAdminWithBlog(null);
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    const result = await runAutopilotNow("t1", "p1", "b1");
    expect(result.error).toBe(AUTOPILOT_ACTION_ERRORS.blog_not_found);
    expect(mockedRunAutopilot).not.toHaveBeenCalled();
  });

  it("rejects when settings.automation.mode !== 'autopilot' (no audit row)", async () => {
    const { client } = makeAdminWithBlog({
      id: "b1",
      settings: MANUAL_SETTINGS,
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    const result = await runAutopilotNow("t1", "p1", "b1");
    expect(result.error).toBe(AUTOPILOT_ACTION_ERRORS.autopilot_disabled);
    expect(mockedRunAutopilot).not.toHaveBeenCalled();
  });

  it("rejects when settings.automation.enabled === false (configured but disarmed)", async () => {
    const { client } = makeAdminWithBlog({
      id: "b1",
      settings: DISABLED_AUTOPILOT_SETTINGS,
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    const result = await runAutopilotNow("t1", "p1", "b1");
    expect(result.error).toBe(AUTOPILOT_ACTION_ERRORS.autopilot_disabled);
    expect(mockedRunAutopilot).not.toHaveBeenCalled();
  });
});

describe("runAutopilotNow — happy path + revalidation", () => {
  it("calls runAutopilotForBlog with triggerSource='manual' and the user id", async () => {
    const { client } = makeAdminWithBlog({
      id: "b1",
      settings: ENABLED_AUTOPILOT_SETTINGS,
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    await runAutopilotNow("t1", "p1", "b1");

    expect(mockedRunAutopilot).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        triggeredByUserId: "u1",
        triggerSource: "manual",
        client: expect.anything(),
      }),
    );
  });

  it("returns a trimmed result and revalidates the settings page", async () => {
    const { client } = makeAdminWithBlog({
      id: "b1",
      settings: ENABLED_AUTOPILOT_SETTINGS,
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    const result = await runAutopilotNow("t1", "p1", "b1");

    expect(result).toEqual({
      data: {
        runId: "run-1",
        status: "completed",
        reason: null,
        ideasGenerated: 2,
        articleJobsStarted: 1,
      },
      error: null,
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      "/teams/t1/projects/p1/blogs/b1/settings",
    );
  });

  it("forwards skipped status + reason to the caller (e.g. 'daily_article_cap_reached')", async () => {
    const { client } = makeAdminWithBlog({
      id: "b1",
      settings: ENABLED_AUTOPILOT_SETTINGS,
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);
    mockedRunAutopilot.mockResolvedValueOnce({
      runId: "run-2",
      status: "skipped",
      reason: "daily_article_cap_reached",
      ideasGenerated: 0,
      articleJobsStarted: 0,
      articleJobIds: [],
      output: {},
    });

    const result = await runAutopilotNow("t1", "p1", "b1");
    expect(result.data).toEqual({
      runId: "run-2",
      status: "skipped",
      reason: "daily_article_cap_reached",
      ideasGenerated: 0,
      articleJobsStarted: 0,
    });
  });

  it("propagates unknown scheduler errors as result.error", async () => {
    const { client } = makeAdminWithBlog({
      id: "b1",
      settings: ENABLED_AUTOPILOT_SETTINGS,
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);
    mockedRunAutopilot.mockRejectedValueOnce(new Error("supabase down"));

    const result = await runAutopilotNow("t1", "p1", "b1");
    expect(result.error).toBe("supabase down");
  });

  it("falls back to a default error message on a non-Error throw", async () => {
    const { client } = makeAdminWithBlog({
      id: "b1",
      settings: ENABLED_AUTOPILOT_SETTINGS,
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);
    mockedRunAutopilot.mockRejectedValueOnce("plain-string-failure");

    const result = await runAutopilotNow("t1", "p1", "b1");
    expect(result.error).toMatch(/Could not run autopilot/);
  });
});

// ============================================================================
// getAutopilotRunDetail
// ============================================================================

const SAMPLE_DETAIL = {
  run: { id: "run-1", blog_id: "b1" } as never,
  jobs: [] as never[],
  articles: [] as never[],
  ideas: [] as never[],
};

describe("getAutopilotRunDetail — auth + validation", () => {
  it("rejects calls missing the blog id", async () => {
    const result = await getAutopilotRunDetail("t1", "p1", "", "run-1");
    expect(result.error).toMatch(/Blog and run ids/);
    expect(mockedGetDetail).not.toHaveBeenCalled();
  });

  it("rejects calls missing the run id", async () => {
    const result = await getAutopilotRunDetail("t1", "p1", "b1", "");
    expect(result.error).toMatch(/Blog and run ids/);
    expect(mockedGetDetail).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mockedCreateClient.mockResolvedValueOnce(makeAuthedClient(null) as never);
    const result = await getAutopilotRunDetail("t1", "p1", "b1", "run-1");
    expect(result.error).toBe(AUTOPILOT_ACTION_ERRORS.not_signed_in);
    expect(mockedAssertCan).not.toHaveBeenCalled();
  });

  it("requires manage_blog permission", async () => {
    const { client } = makeAdminWithBlog({ id: "b1", settings: {} });
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    await getAutopilotRunDetail("t1", "p1", "b1", "run-1");

    expect(mockedAssertCan).toHaveBeenCalledWith(
      "t1",
      "u1",
      "manage_blog",
      expect.anything(),
    );
  });

  it("returns the TeamPermissionError code on permission failure", async () => {
    mockedAssertCan.mockRejectedValueOnce(
      new TeamPermissionError("forbidden", "manage_blog", "member" as never),
    );
    const result = await getAutopilotRunDetail("t1", "p1", "b1", "run-1");
    expect(result.error).toBe("forbidden");
    expect(mockedGetDetail).not.toHaveBeenCalled();
  });
});

describe("getAutopilotRunDetail — happy path + lookups", () => {
  it("returns blog_not_found when the blog isn't in this project", async () => {
    const { client } = makeAdminWithBlog(null);
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    const result = await getAutopilotRunDetail("t1", "p1", "b1", "run-1");
    expect(result.error).toBe(AUTOPILOT_ACTION_ERRORS.blog_not_found);
    expect(mockedGetDetail).not.toHaveBeenCalled();
  });

  it("returns 'Run not found.' when the detail loader returns null", async () => {
    const { client } = makeAdminWithBlog({ id: "b1", settings: {} });
    mockedCreateAdmin.mockReturnValueOnce(client as never);
    mockedGetDetail.mockResolvedValueOnce(null);

    const result = await getAutopilotRunDetail("t1", "p1", "b1", "run-1");
    expect(result.error).toMatch(/Run not found/);
  });

  it("returns the loaded detail when everything resolves", async () => {
    const { client } = makeAdminWithBlog({ id: "b1", settings: {} });
    mockedCreateAdmin.mockReturnValueOnce(client as never);
    mockedGetDetail.mockResolvedValueOnce(SAMPLE_DETAIL as never);

    const result = await getAutopilotRunDetail("t1", "p1", "b1", "run-1");
    expect(result).toEqual({ data: SAMPLE_DETAIL, error: null });
    expect(mockedGetDetail).toHaveBeenCalledWith({
      blogId: "b1",
      runId: "run-1",
      client: expect.anything(),
    });
  });

  it("propagates unexpected errors as result.error", async () => {
    const { client } = makeAdminWithBlog({ id: "b1", settings: {} });
    mockedCreateAdmin.mockReturnValueOnce(client as never);
    mockedGetDetail.mockRejectedValueOnce(new Error("supabase down"));

    const result = await getAutopilotRunDetail("t1", "p1", "b1", "run-1");
    expect(result.error).toBe("supabase down");
  });

  it("falls back to a default message on non-Error throws", async () => {
    const { client } = makeAdminWithBlog({ id: "b1", settings: {} });
    mockedCreateAdmin.mockReturnValueOnce(client as never);
    mockedGetDetail.mockRejectedValueOnce("not-an-error");

    const result = await getAutopilotRunDetail("t1", "p1", "b1", "run-1");
    expect(result.error).toMatch(/Could not load run details/);
  });
});
