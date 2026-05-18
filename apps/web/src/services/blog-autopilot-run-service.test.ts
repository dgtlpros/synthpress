import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  BLOG_AUTOPILOT_RUN_STATUSES,
  BLOG_AUTOPILOT_RUN_STEPS,
  BLOG_AUTOPILOT_RUN_TRIGGER_SOURCES,
  completeBlogAutopilotRun,
  countWordPressDraftOutcomes,
  createBlogAutopilotRun,
  failBlogAutopilotRun,
  getBlogAutopilotRunDetail,
  listBlogAutopilotRunsForBlog,
  setBlogAutopilotRunWordPressDraftCounters,
  syncAutopilotRunWordPressDraftCounters,
  updateBlogAutopilotRunStatus,
} from "./blog-autopilot-run-service";

const mockedCreateAdmin = vi.mocked(createAdminClient);

// ---- Mock Supabase chain helpers ----------------------------------------

interface ChainResult<T> {
  data: T;
  error: { code?: string; message?: string } | null;
}

function makeChain<T>(result: ChainResult<T>) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  };
  return chain;
}

interface MockClient {
  from: ReturnType<typeof vi.fn>;
  __chain: ReturnType<typeof makeChain>;
}

function makeClient<T>(result: ChainResult<T>): MockClient {
  const chain = makeChain(result);
  const client = {
    from: vi.fn(() => chain),
    __chain: chain,
  };
  return client as unknown as MockClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ============================================================================
// Constants
// ============================================================================

describe("constants", () => {
  it("exposes the four trigger sources", () => {
    expect(BLOG_AUTOPILOT_RUN_TRIGGER_SOURCES).toEqual([
      "cron",
      "manual",
      "workflow",
      "system",
    ]);
  });

  it("exposes the six lifecycle statuses including 'skipped'", () => {
    expect(BLOG_AUTOPILOT_RUN_STATUSES).toEqual([
      "pending",
      "processing",
      "completed",
      "failed",
      "cancelled",
      "skipped",
    ]);
  });

  it("exposes the known scheduler steps", () => {
    expect(BLOG_AUTOPILOT_RUN_STEPS).toEqual([
      "loading_settings",
      "checking_budget",
      "checking_backlog",
      "generating_ideas",
      "generating_articles",
      "completed",
    ]);
  });
});

// ============================================================================
// createBlogAutopilotRun
// ============================================================================

describe("createBlogAutopilotRun", () => {
  it("inserts a pending cron run with sensible defaults", async () => {
    const inserted = {
      id: "run-1",
      team_id: "t1",
      project_id: "p1",
      blog_id: "b1",
      triggered_by_user_id: null,
      trigger_source: "cron",
      status: "pending",
    };
    const client = makeClient({ data: inserted, error: null });

    const result = await createBlogAutopilotRun({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      client: client as never,
    });

    expect(result).toEqual(inserted);
    expect(client.from).toHaveBeenCalledWith("blog_autopilot_runs");
    expect(client.__chain.insert).toHaveBeenCalledWith({
      team_id: "t1",
      project_id: "p1",
      blog_id: "b1",
      triggered_by_user_id: null,
      trigger_source: "cron",
      status: "pending",
      current_step: null,
      scheduled_for: null,
      input: {},
    });
  });

  it("respects explicit triggerSource, status, currentStep, and input", async () => {
    const client = makeClient({ data: { id: "run-2" }, error: null });

    await createBlogAutopilotRun({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      triggeredByUserId: "u1",
      triggerSource: "manual",
      status: "processing",
      currentStep: "loading_settings",
      input: { backlogTarget: 10 },
      client: client as never,
    });

    expect(client.__chain.insert).toHaveBeenCalledWith({
      team_id: "t1",
      project_id: "p1",
      blog_id: "b1",
      triggered_by_user_id: "u1",
      trigger_source: "manual",
      status: "processing",
      current_step: "loading_settings",
      scheduled_for: null,
      input: { backlogTarget: 10 },
    });
  });

  it("converts a Date scheduledFor to ISO", async () => {
    const client = makeClient({ data: { id: "run-3" }, error: null });
    const when = new Date("2026-06-01T12:00:00Z");

    await createBlogAutopilotRun({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      scheduledFor: when,
      client: client as never,
    });

    const insertArg = client.__chain.insert.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(insertArg.scheduled_for).toBe("2026-06-01T12:00:00.000Z");
  });

  it("passes through a string scheduledFor unchanged", async () => {
    const client = makeClient({ data: { id: "run-4" }, error: null });

    await createBlogAutopilotRun({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      scheduledFor: "2026-06-01T12:00:00Z",
      client: client as never,
    });

    const insertArg = client.__chain.insert.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(insertArg.scheduled_for).toBe("2026-06-01T12:00:00Z");
  });

  it("falls back to the admin client when none is injected", async () => {
    const adminClient = makeClient({ data: { id: "run-5" }, error: null });
    mockedCreateAdmin.mockReturnValue(adminClient as never);

    await createBlogAutopilotRun({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
    });

    expect(mockedCreateAdmin).toHaveBeenCalled();
    expect(adminClient.from).toHaveBeenCalledWith("blog_autopilot_runs");
  });

  it("propagates the DB error", async () => {
    const client = makeClient({
      data: null,
      error: { message: "boom" },
    });

    await expect(
      createBlogAutopilotRun({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "boom" });
  });
});

// ============================================================================
// updateBlogAutopilotRunStatus
// ============================================================================

describe("updateBlogAutopilotRunStatus", () => {
  it("does nothing when no fields and no counter delta are provided", async () => {
    const client = makeClient({ data: null, error: null });

    await updateBlogAutopilotRunStatus({
      runId: "run-1",
      client: client as never,
    });

    expect(client.from).not.toHaveBeenCalled();
  });

  it("patches status / step / errorMessage when provided", async () => {
    const client = makeClient({ data: null, error: null });

    await updateBlogAutopilotRunStatus({
      runId: "run-1",
      status: "failed",
      currentStep: "generating_articles",
      errorMessage: "model timeout",
      client: client as never,
    });

    expect(client.__chain.update).toHaveBeenCalledWith({
      status: "failed",
      current_step: "generating_articles",
      error_message: "model timeout",
    });
    expect(client.__chain.eq).toHaveBeenCalledWith("id", "run-1");
  });

  it("auto-stamps started_at when transitioning to processing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T00:00:00Z"));
    const client = makeClient({ data: null, error: null });

    await updateBlogAutopilotRunStatus({
      runId: "run-1",
      status: "processing",
      client: client as never,
    });

    expect(client.__chain.update).toHaveBeenCalledWith({
      status: "processing",
      started_at: "2026-05-07T00:00:00.000Z",
    });
  });

  it("ignores a counter delta object that has no defined fields", async () => {
    const client = makeClient({ data: null, error: null });

    await updateBlogAutopilotRunStatus({
      runId: "run-1",
      status: "processing",
      countersDelta: {},
      client: client as never,
    });

    // Only one call to .from — no counter read happened.
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.__chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing" }),
    );
  });

  it("reads the row and adds counter deltas atomically with the patch", async () => {
    const client = makeClient({
      data: {
        ideas_generated: 5,
        articles_started: 2,
        articles_completed: 0,
        articles_failed: 0,
        tokens_spent: 0,
        tokens_refunded: 0,
      },
      error: null,
    });

    await updateBlogAutopilotRunStatus({
      runId: "run-1",
      currentStep: "generating_articles",
      countersDelta: { ideasGenerated: 3, articlesStarted: 1 },
      client: client as never,
    });

    expect(client.__chain.update).toHaveBeenCalledWith({
      current_step: "generating_articles",
      ideas_generated: 8,
      articles_started: 3,
    });
  });

  it("treats missing counter columns as 0 when computing the new value", async () => {
    const client = makeClient({
      data: {
        // articles_completed missing — should be treated as 0.
        ideas_generated: 1,
      },
      error: null,
    });

    await updateBlogAutopilotRunStatus({
      runId: "run-1",
      countersDelta: { articlesCompleted: 4 },
      client: client as never,
    });

    expect(client.__chain.update).toHaveBeenCalledWith({
      articles_completed: 4,
    });
  });

  it("rejects negative counter deltas", async () => {
    const client = makeClient({ data: null, error: null });

    await expect(
      updateBlogAutopilotRunStatus({
        runId: "run-1",
        countersDelta: { ideasGenerated: -1 },
        client: client as never,
      }),
    ).rejects.toThrow(/non-negative/);
  });

  it("rejects non-finite counter deltas", async () => {
    const client = makeClient({ data: null, error: null });

    await expect(
      updateBlogAutopilotRunStatus({
        runId: "run-1",
        countersDelta: { tokensSpent: Number.NaN },
        client: client as never,
      }),
    ).rejects.toThrow(/non-negative/);
  });

  it("rejects non-numeric counter deltas (TS escape hatch)", async () => {
    const client = makeClient({ data: null, error: null });

    await expect(
      updateBlogAutopilotRunStatus({
        runId: "run-1",
        countersDelta: { tokensSpent: "ten" as unknown as number },
        client: client as never,
      }),
    ).rejects.toThrow(/non-negative/);
  });

  it("throws if the run row is missing during a counter increment", async () => {
    const client = makeClient({ data: null, error: null });

    await expect(
      updateBlogAutopilotRunStatus({
        runId: "missing",
        countersDelta: { ideasGenerated: 1 },
        client: client as never,
      }),
    ).rejects.toThrow(/Autopilot run missing not found/);
  });

  it("propagates the read error during counter increment", async () => {
    const client = makeClient({
      data: null,
      error: { message: "read fail" },
    });

    await expect(
      updateBlogAutopilotRunStatus({
        runId: "run-1",
        countersDelta: { ideasGenerated: 1 },
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "read fail" });
  });

  it("propagates the write error", async () => {
    const reads = [
      { data: { ideas_generated: 0 }, error: null },
      { data: null, error: { message: "write fail" } },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockImplementation(() => {
        return Promise.resolve(reads.shift());
      }),
      single: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      // The trick: .update().eq() must resolve to the second element.
      update: vi.fn().mockImplementation(() => ({
        eq: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: "write fail" } }),
      })),
    };
    const client = { from: vi.fn(() => chain) } as unknown as {
      from: ReturnType<typeof vi.fn>;
    };

    await expect(
      updateBlogAutopilotRunStatus({
        runId: "run-1",
        countersDelta: { ideasGenerated: 1 },
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "write fail" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const adminClient = makeClient({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(adminClient as never);

    await updateBlogAutopilotRunStatus({
      runId: "run-1",
      status: "cancelled",
    });

    expect(mockedCreateAdmin).toHaveBeenCalled();
    expect(adminClient.from).toHaveBeenCalledWith("blog_autopilot_runs");
  });
});

// ============================================================================
// completeBlogAutopilotRun
// ============================================================================

describe("completeBlogAutopilotRun", () => {
  it("marks the run completed with current_step='completed' and completed_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T00:01:00Z"));
    const client = makeClient({ data: null, error: null });

    await completeBlogAutopilotRun({
      runId: "run-1",
      output: { jobIds: ["j1", "j2"] },
      client: client as never,
    });

    expect(client.__chain.update).toHaveBeenCalledWith({
      status: "completed",
      current_step: "completed",
      completed_at: "2026-05-07T00:01:00.000Z",
      output: { jobIds: ["j1", "j2"] },
    });
  });

  it("supports a 'skipped' final status (clean ending, no work produced)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T00:02:00Z"));
    const client = makeClient({ data: null, error: null });

    await completeBlogAutopilotRun({
      runId: "run-1",
      status: "skipped",
      output: { reason: "backlog full" },
      client: client as never,
    });

    expect(client.__chain.update).toHaveBeenCalledWith({
      status: "skipped",
      current_step: "completed",
      completed_at: "2026-05-07T00:02:00.000Z",
      output: { reason: "backlog full" },
    });
  });

  it("folds in counter deltas alongside the completion patch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T00:03:00Z"));
    const client = makeClient({
      data: {
        ideas_generated: 10,
        articles_started: 4,
        articles_completed: 3,
        articles_failed: 1,
        tokens_spent: 25,
        tokens_refunded: 5,
      },
      error: null,
    });

    await completeBlogAutopilotRun({
      runId: "run-1",
      countersDelta: { tokensRefunded: 2, articlesCompleted: 1 },
      client: client as never,
    });

    expect(client.__chain.update).toHaveBeenCalledWith({
      status: "completed",
      current_step: "completed",
      completed_at: "2026-05-07T00:03:00.000Z",
      tokens_refunded: 7,
      articles_completed: 4,
    });
  });

  it("ignores a counter delta object with no defined fields", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T00:04:00Z"));
    const client = makeClient({ data: null, error: null });

    await completeBlogAutopilotRun({
      runId: "run-1",
      countersDelta: {},
      client: client as never,
    });

    // Only one call to .from — no counter read happened.
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("rejects negative counter deltas on completion", async () => {
    const client = makeClient({ data: null, error: null });

    await expect(
      completeBlogAutopilotRun({
        runId: "run-1",
        countersDelta: { tokensSpent: -1 },
        client: client as never,
      }),
    ).rejects.toThrow(/non-negative/);
  });

  it("propagates the write error", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(),
      maybeSingle: vi.fn(),
      single: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockImplementation(() => ({
        eq: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: "boom" } }),
      })),
    };
    const client = { from: vi.fn(() => chain) } as unknown as {
      from: ReturnType<typeof vi.fn>;
    };

    await expect(
      completeBlogAutopilotRun({
        runId: "run-1",
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "boom" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const adminClient = makeClient({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(adminClient as never);

    await completeBlogAutopilotRun({ runId: "run-1" });

    expect(mockedCreateAdmin).toHaveBeenCalled();
    expect(adminClient.from).toHaveBeenCalledWith("blog_autopilot_runs");
  });
});

// ============================================================================
// failBlogAutopilotRun
// ============================================================================

describe("failBlogAutopilotRun", () => {
  it("marks the run failed with error_message and completed_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T00:10:00Z"));
    const client = makeClient({ data: null, error: null });

    await failBlogAutopilotRun({
      runId: "run-1",
      errorMessage: "model API down",
      output: { partial: true },
      client: client as never,
    });

    expect(client.__chain.update).toHaveBeenCalledWith({
      status: "failed",
      error_message: "model API down",
      completed_at: "2026-05-07T00:10:00.000Z",
      output: { partial: true },
    });
  });

  it("folds in counter deltas alongside the failure patch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T00:11:00Z"));
    const client = makeClient({
      data: { tokens_refunded: 3 },
      error: null,
    });

    await failBlogAutopilotRun({
      runId: "run-1",
      errorMessage: "model API down",
      countersDelta: { tokensRefunded: 5 },
      client: client as never,
    });

    expect(client.__chain.update).toHaveBeenCalledWith({
      status: "failed",
      error_message: "model API down",
      completed_at: "2026-05-07T00:11:00.000Z",
      tokens_refunded: 8,
    });
  });

  it("ignores a counter delta object with no defined fields", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T00:12:00Z"));
    const client = makeClient({ data: null, error: null });

    await failBlogAutopilotRun({
      runId: "run-1",
      errorMessage: "boom",
      countersDelta: {},
      client: client as never,
    });

    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("rejects negative counter deltas on failure", async () => {
    const client = makeClient({ data: null, error: null });

    await expect(
      failBlogAutopilotRun({
        runId: "run-1",
        errorMessage: "boom",
        countersDelta: { tokensRefunded: -2 },
        client: client as never,
      }),
    ).rejects.toThrow(/non-negative/);
  });

  it("propagates the write error", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(),
      maybeSingle: vi.fn(),
      single: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockImplementation(() => ({
        eq: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: "boom" } }),
      })),
    };
    const client = { from: vi.fn(() => chain) } as unknown as {
      from: ReturnType<typeof vi.fn>;
    };

    await expect(
      failBlogAutopilotRun({
        runId: "run-1",
        errorMessage: "boom",
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "boom" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const adminClient = makeClient({ data: null, error: null });
    mockedCreateAdmin.mockReturnValue(adminClient as never);

    await failBlogAutopilotRun({ runId: "run-1", errorMessage: "boom" });

    expect(mockedCreateAdmin).toHaveBeenCalled();
    expect(adminClient.from).toHaveBeenCalledWith("blog_autopilot_runs");
  });
});

// ============================================================================
// listBlogAutopilotRunsForBlog
// ============================================================================

describe("listBlogAutopilotRunsForBlog", () => {
  it("returns rows ordered newest-first with the default limit", async () => {
    const rows = [
      { id: "r2", created_at: "2026-05-07" },
      { id: "r1", created_at: "2026-05-06" },
    ];
    const client = makeClient({ data: rows, error: null });

    const result = await listBlogAutopilotRunsForBlog("b1", {
      client: client as never,
    });

    expect(result).toEqual(rows);
    expect(client.from).toHaveBeenCalledWith("blog_autopilot_runs");
    expect(client.__chain.eq).toHaveBeenCalledWith("blog_id", "b1");
    expect(client.__chain.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(client.__chain.limit).toHaveBeenCalledWith(25);
  });

  it("applies a status filter when provided", async () => {
    const client = makeClient({ data: [], error: null });

    await listBlogAutopilotRunsForBlog("b1", {
      statuses: ["failed", "skipped"],
      client: client as never,
    });

    expect(client.__chain.in).toHaveBeenCalledWith("status", [
      "failed",
      "skipped",
    ]);
  });

  it("does NOT apply an empty status filter", async () => {
    const client = makeClient({ data: [], error: null });

    await listBlogAutopilotRunsForBlog("b1", {
      statuses: [],
      client: client as never,
    });

    expect(client.__chain.in).not.toHaveBeenCalled();
  });

  it("clamps a custom limit at MAX_RUN_LIST_LIMIT (200)", async () => {
    const client = makeClient({ data: [], error: null });

    await listBlogAutopilotRunsForBlog("b1", {
      limit: 1_000_000,
      client: client as never,
    });

    expect(client.__chain.limit).toHaveBeenCalledWith(200);
  });

  it("falls back to the default limit when given a non-finite limit", async () => {
    const client = makeClient({ data: [], error: null });

    await listBlogAutopilotRunsForBlog("b1", {
      limit: Number.NaN,
      client: client as never,
    });

    expect(client.__chain.limit).toHaveBeenCalledWith(25);
  });

  it("falls back to the default limit when given a non-positive limit", async () => {
    const client = makeClient({ data: [], error: null });

    await listBlogAutopilotRunsForBlog("b1", {
      limit: 0,
      client: client as never,
    });

    expect(client.__chain.limit).toHaveBeenCalledWith(25);
  });

  it("floors fractional custom limits", async () => {
    const client = makeClient({ data: [], error: null });

    await listBlogAutopilotRunsForBlog("b1", {
      limit: 12.7,
      client: client as never,
    });

    expect(client.__chain.limit).toHaveBeenCalledWith(12);
  });

  it("returns [] when the query yields null data", async () => {
    const client = makeClient({ data: null, error: null });

    const result = await listBlogAutopilotRunsForBlog("b1", {
      client: client as never,
    });

    expect(result).toEqual([]);
  });

  it("propagates the query error", async () => {
    const client = makeClient({
      data: null,
      error: { message: "boom" },
    });

    await expect(
      listBlogAutopilotRunsForBlog("b1", { client: client as never }),
    ).rejects.toMatchObject({ message: "boom" });
  });

  it("falls back to the admin client when none is injected", async () => {
    const adminClient = makeClient({ data: [], error: null });
    mockedCreateAdmin.mockReturnValue(adminClient as never);

    await listBlogAutopilotRunsForBlog("b1");

    expect(mockedCreateAdmin).toHaveBeenCalled();
    expect(adminClient.from).toHaveBeenCalledWith("blog_autopilot_runs");
  });
});

// ============================================================================
// getBlogAutopilotRunDetail
// ============================================================================

/**
 * Multi-table mock — the detail loader hits 4 different tables.
 * Each chain has its own .order/.maybeSingle/.then so we can stage
 * results per table independently.
 */
interface ChainMock {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  filter: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: PromiseLike<unknown>["then"];
}

function makeQueryChain<T>(result: ChainResult<T>): ChainMock {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: ((onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected)) as PromiseLike<
      ChainResult<T>
    >["then"],
  };
  return chain as unknown as ChainMock;
}

interface DetailMockClient {
  from: ReturnType<typeof vi.fn>;
  __chains: Record<string, ChainMock>;
}

function makeDetailClient(perTable: {
  blog_autopilot_runs?: ChainResult<unknown>;
  article_jobs?: ChainResult<unknown>;
  articles?: ChainResult<unknown>;
  article_ideas?: ChainResult<unknown>;
}): DetailMockClient {
  const chains: Record<string, ChainMock> = {};
  for (const [name, result] of Object.entries(perTable)) {
    chains[name] = makeQueryChain(
      (result ?? { data: null, error: null }) as ChainResult<unknown>,
    );
  }
  const client = {
    from: vi.fn((name: string) => {
      if (!chains[name])
        chains[name] = makeQueryChain({ data: null, error: null });
      return chains[name];
    }),
    __chains: chains,
  };
  return client as unknown as DetailMockClient;
}

describe("getBlogAutopilotRunDetail", () => {
  const RUN_ROW = {
    id: "run-1",
    blog_id: "blog-1",
    project_id: "p1",
    team_id: "t1",
    status: "completed",
    trigger_source: "cron",
    current_step: "completed",
    error_message: null,
    input: { triggerSource: "cron" },
    output: { reason: "ok" },
    ideas_generated: 5,
    articles_started: 2,
    articles_completed: 0,
    articles_failed: 0,
    tokens_spent: 10,
    tokens_refunded: 0,
    started_at: "2026-05-11T08:00:00Z",
    completed_at: "2026-05-11T08:01:00Z",
    created_at: "2026-05-11T08:00:00Z",
    triggered_by_user_id: null,
    scheduled_for: null,
    updated_at: "2026-05-11T08:01:00Z",
  };

  it("returns null when the run row is missing for that blog", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: null, error: null },
    });
    const out = await getBlogAutopilotRunDetail({
      blogId: "blog-1",
      runId: "run-missing",
      client: client as never,
    });
    expect(out).toBeNull();
    // Detail loader bails after the first query — no jobs / articles
    // / ideas queries fired.
    expect(client.__chains.article_jobs).toBeUndefined();
  });

  it("scopes the run lookup by both id and blog_id (defense in depth)", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: RUN_ROW, error: null },
      article_jobs: { data: [], error: null },
    });
    await getBlogAutopilotRunDetail({
      blogId: "blog-AA",
      runId: "run-1",
      client: client as never,
    });

    const eqCalls = client.__chains.blog_autopilot_runs!.eq.mock.calls.map(
      (c) => [c[0], c[1]] as const,
    );
    expect(eqCalls).toContainEqual(["id", "run-1"]);
    expect(eqCalls).toContainEqual(["blog_id", "blog-AA"]);
  });

  it("loads related article_jobs filtered by input.autopilotRunId", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: RUN_ROW, error: null },
      article_jobs: {
        data: [
          {
            id: "job-1",
            type: "generate_article",
            status: "completed",
            current_step: "completed",
            error_message: null,
            input: { autopilotRunId: "run-1" },
            output: { model: "claude" },
            article_id: "art-1",
            article_idea_id: "idea-1",
            created_at: "2026-05-11T08:00:30Z",
            started_at: "2026-05-11T08:00:31Z",
            completed_at: "2026-05-11T08:01:00Z",
          },
        ],
        error: null,
      },
      articles: {
        data: [
          {
            id: "art-1",
            title: "Hello",
            slug: "hello",
            status: "ready_for_review",
            word_count: 1200,
            target_keyword: "hello",
            created_at: "2026-05-11T08:01:00Z",
            updated_at: "2026-05-11T08:01:00Z",
          },
        ],
        error: null,
      },
      article_ideas: {
        data: [
          {
            id: "idea-1",
            title: "Hello idea",
            status: "converted_to_article",
            target_keyword: "hello",
            executive_summary: "x",
            created_at: "2026-05-11T07:55:00Z",
          },
        ],
        error: null,
      },
    });

    const out = await getBlogAutopilotRunDetail({
      blogId: "blog-1",
      runId: "run-1",
      client: client as never,
    });

    expect(out).not.toBeNull();
    expect(out!.run.id).toBe("run-1");
    expect(out!.jobs).toHaveLength(1);
    expect(out!.jobs[0]).toMatchObject({
      id: "job-1",
      articleId: "art-1",
      articleIdeaId: "idea-1",
    });

    // The crucial filter — input->>autopilotRunId — is on the
    // article_jobs chain.
    expect(client.__chains.article_jobs!.filter).toHaveBeenCalledWith(
      "input->>autopilotRunId",
      "eq",
      "run-1",
    );

    expect(out!.articles).toHaveLength(1);
    expect(out!.articles[0]!.title).toBe("Hello");
    expect(out!.ideas).toHaveLength(1);
    expect(out!.ideas[0]!.title).toBe("Hello idea");
  });

  it("skips the articles + ideas queries when no jobs reference any", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: RUN_ROW, error: null },
      // Job exists but it's a generate_ideas job — no article_id /
      // article_idea_id link.
      article_jobs: {
        data: [
          {
            id: "job-ideas",
            type: "generate_ideas",
            status: "completed",
            current_step: "completed",
            error_message: null,
            input: { autopilotRunId: "run-1" },
            output: null,
            article_id: null,
            article_idea_id: null,
            created_at: "2026-05-11T08:00:00Z",
            started_at: "2026-05-11T08:00:01Z",
            completed_at: "2026-05-11T08:00:30Z",
          },
        ],
        error: null,
      },
    });

    const out = await getBlogAutopilotRunDetail({
      blogId: "blog-1",
      runId: "run-1",
      client: client as never,
    });

    expect(out!.articles).toEqual([]);
    expect(out!.ideas).toEqual([]);
    // Two `from()` calls: blog_autopilot_runs + article_jobs.
    // No follow-up articles / article_ideas calls.
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it("dedupes article + idea ids across jobs (one query per unique row)", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: RUN_ROW, error: null },
      article_jobs: {
        data: [
          {
            id: "j1",
            type: "generate_article",
            status: "completed",
            current_step: "completed",
            error_message: null,
            input: {},
            output: null,
            article_id: "art-X",
            article_idea_id: "idea-X",
            created_at: "2026-05-11T08:00:30Z",
            started_at: null,
            completed_at: null,
          },
          // Same article + idea (re-run / retry scenario)
          {
            id: "j2",
            type: "generate_article",
            status: "failed",
            current_step: "writing_article",
            error_message: "boom",
            input: {},
            output: null,
            article_id: "art-X",
            article_idea_id: "idea-X",
            created_at: "2026-05-11T08:00:35Z",
            started_at: null,
            completed_at: null,
          },
        ],
        error: null,
      },
      articles: {
        data: [
          {
            id: "art-X",
            title: "X",
            slug: "x",
            status: "failed",
            word_count: null,
            target_keyword: null,
            created_at: "2026-05-11T08:00:30Z",
            updated_at: "2026-05-11T08:00:30Z",
          },
        ],
        error: null,
      },
      article_ideas: {
        data: [
          {
            id: "idea-X",
            title: "X idea",
            status: "approved",
            target_keyword: null,
            executive_summary: null,
            created_at: "2026-05-11T07:55:00Z",
          },
        ],
        error: null,
      },
    });

    const out = await getBlogAutopilotRunDetail({
      blogId: "blog-1",
      runId: "run-1",
      client: client as never,
    });

    expect(client.__chains.articles!.in).toHaveBeenCalledWith("id", ["art-X"]);
    expect(client.__chains.article_ideas!.in).toHaveBeenCalledWith("id", [
      "idea-X",
    ]);
    expect(out!.articles).toHaveLength(1);
    expect(out!.ideas).toHaveLength(1);
  });

  it("propagates run-row read errors", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: null, error: { message: "rls denied" } },
    });
    await expect(
      getBlogAutopilotRunDetail({
        blogId: "blog-1",
        runId: "run-1",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "rls denied" });
  });

  it("propagates jobs-query errors", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: RUN_ROW, error: null },
      article_jobs: { data: null, error: { message: "jobs broke" } },
    });
    await expect(
      getBlogAutopilotRunDetail({
        blogId: "blog-1",
        runId: "run-1",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "jobs broke" });
  });

  it("propagates articles-query errors", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: RUN_ROW, error: null },
      article_jobs: {
        data: [
          {
            id: "j1",
            type: "generate_article",
            status: "completed",
            current_step: null,
            error_message: null,
            input: {},
            output: null,
            article_id: "art-1",
            article_idea_id: null,
            created_at: "2026-05-11T08:00:30Z",
            started_at: null,
            completed_at: null,
          },
        ],
        error: null,
      },
      articles: { data: null, error: { message: "articles broke" } },
    });
    await expect(
      getBlogAutopilotRunDetail({
        blogId: "blog-1",
        runId: "run-1",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "articles broke" });
  });

  it("propagates ideas-query errors", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: RUN_ROW, error: null },
      article_jobs: {
        data: [
          {
            id: "j1",
            type: "generate_article",
            status: "completed",
            current_step: null,
            error_message: null,
            input: {},
            output: null,
            article_id: null,
            article_idea_id: "idea-1",
            created_at: "2026-05-11T08:00:30Z",
            started_at: null,
            completed_at: null,
          },
        ],
        error: null,
      },
      article_ideas: { data: null, error: { message: "ideas broke" } },
    });
    await expect(
      getBlogAutopilotRunDetail({
        blogId: "blog-1",
        runId: "run-1",
        client: client as never,
      }),
    ).rejects.toEqual({ message: "ideas broke" });
  });

  it("falls back to the admin client when none is supplied", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    await getBlogAutopilotRunDetail({
      blogId: "blog-1",
      runId: "run-1",
    });
    expect(mockedCreateAdmin).toHaveBeenCalledTimes(1);
  });

  it("treats null PostgREST data arrays as empty (defensive)", async () => {
    const client = makeDetailClient({
      blog_autopilot_runs: { data: RUN_ROW, error: null },
      article_jobs: { data: null, error: null },
    });
    const out = await getBlogAutopilotRunDetail({
      blogId: "blog-1",
      runId: "run-1",
      client: client as never,
    });
    expect(out!.jobs).toEqual([]);
    expect(out!.articles).toEqual([]);
    expect(out!.ideas).toEqual([]);
  });
});

// ============================================================================
// WordPress draft counters (v11)
// ============================================================================

describe("countWordPressDraftOutcomes", () => {
  it("returns zero counts for an empty list", () => {
    expect(countWordPressDraftOutcomes([])).toEqual({
      expected: 0,
      created: 0,
      alreadySent: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("tallies every known status into the right bucket", () => {
    const counts = countWordPressDraftOutcomes([
      { output: { wpPublish: { status: "draft_created" } } },
      { output: { wpPublish: { status: "draft_created" } } },
      { output: { wpPublish: { status: "already_sent" } } },
      { output: { wpPublish: { status: "skipped_no_connection" } } },
      { output: { wpPublish: { status: "failed" } } },
    ]);
    expect(counts).toEqual({
      expected: 5,
      created: 2,
      alreadySent: 1,
      skipped: 1,
      failed: 1,
    });
  });

  it("ignores rows whose output is null (legacy / manual jobs)", () => {
    const counts = countWordPressDraftOutcomes([
      { output: null },
      { output: { wpPublish: { status: "draft_created" } } },
    ]);
    expect(counts.expected).toBe(1);
    expect(counts.created).toBe(1);
  });

  it("ignores rows whose output is not an object (forward-compat)", () => {
    const counts = countWordPressDraftOutcomes([
      { output: "oops" as never },
      { output: 42 as never },
      { output: [1, 2, 3] as never },
      { output: { wpPublish: { status: "draft_created" } } },
    ]);
    expect(counts.created).toBe(1);
    expect(counts.expected).toBe(1);
  });

  it("ignores rows whose wpPublish is missing (e.g. picker-only output, gate-skip cases)", () => {
    const counts = countWordPressDraftOutcomes([
      {
        output: {
          model: "claude-x",
          imageSummary: { warnings: [] },
        },
      },
    ]);
    expect(counts).toEqual({
      expected: 0,
      created: 0,
      alreadySent: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("ignores rows whose wpPublish is malformed (not an object / array / wrong status type)", () => {
    const counts = countWordPressDraftOutcomes([
      { output: { wpPublish: null } },
      { output: { wpPublish: [1, 2] } },
      { output: { wpPublish: { status: 42 } } },
      { output: { wpPublish: { status: "draft_created" } } },
    ]);
    expect(counts.created).toBe(1);
    expect(counts.expected).toBe(1);
  });

  it("ignores unknown wpPublish.status values (silent forward-compat for v12+ statuses)", () => {
    const counts = countWordPressDraftOutcomes([
      { output: { wpPublish: { status: "some_future_status" } } },
      { output: { wpPublish: { status: "draft_created" } } },
    ]);
    expect(counts.created).toBe(1);
    expect(counts.expected).toBe(1);
  });
});

/**
 * Builds a client whose chain resolves via `then` (not `maybeSingle`
 * / `limit`). The WP-draft counter helpers do `await
 * supabase.from(...).update(...).eq(...)` — they don't terminate
 * at `.maybeSingle()` or `.limit()`, so the chain itself needs to
 * be thenable. Used by the `setBlogAutopilotRunWordPressDraftCounters`
 * tests below.
 */
function makeUpdateClient(result: ChainResult<unknown>): MockClient {
  const chain = makeChain(result);
  (chain as unknown as PromiseLike<ChainResult<unknown>>).then = ((
    onFulfilled: ((value: ChainResult<unknown>) => unknown) | null | undefined,
    onRejected: ((reason: unknown) => unknown) | null | undefined,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)) as never;
  const client = {
    from: vi.fn(() => chain),
    __chain: chain,
  };
  return client as unknown as MockClient;
}

describe("setBlogAutopilotRunWordPressDraftCounters", () => {
  it("UPDATEs the wp_drafts_* columns to absolute values", async () => {
    const client = makeUpdateClient({ data: null, error: null });
    await setBlogAutopilotRunWordPressDraftCounters({
      runId: "run-1",
      counters: {
        expected: 5,
        created: 3,
        alreadySent: 1,
        skipped: 0,
        failed: 1,
      },
      client: client as never,
    });
    expect(client.__chain.update).toHaveBeenCalledWith({
      wp_drafts_expected: 5,
      wp_drafts_created: 3,
      wp_drafts_already_sent: 1,
      wp_drafts_skipped: 0,
      wp_drafts_failed: 1,
    });
    expect(client.__chain.eq).toHaveBeenCalledWith("id", "run-1");
  });

  it("propagates Supabase UPDATE errors as-is", async () => {
    const client = makeUpdateClient({
      data: null,
      error: { message: "denied" },
    });
    await expect(
      setBlogAutopilotRunWordPressDraftCounters({
        runId: "run-1",
        counters: {
          expected: 0,
          created: 0,
          alreadySent: 0,
          skipped: 0,
          failed: 0,
        },
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "denied" });
  });

  it("falls back to the admin client when none is supplied", async () => {
    const client = makeUpdateClient({ data: null, error: null });
    mockedCreateAdmin.mockReturnValueOnce(client as never);
    await setBlogAutopilotRunWordPressDraftCounters({
      runId: "run-1",
      counters: {
        expected: 0,
        created: 0,
        alreadySent: 0,
        skipped: 0,
        failed: 0,
      },
    });
    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});

describe("syncAutopilotRunWordPressDraftCounters", () => {
  /**
   * Two-table mock: `article_jobs` resolves the SELECT for jobs;
   * `blog_autopilot_runs` resolves the UPDATE write. Each
   * `from(table)` call gets its own chain so the SELECT's
   * terminal (the chain's then-able shape) doesn't collide with
   * the UPDATE's terminal.
   */
  function makeTwoTableClient(opts: {
    jobs: ChainResult<unknown>;
    update: ChainResult<unknown>;
  }) {
    const jobsChain = makeChain(opts.jobs);
    const runUpdateChain = makeChain(opts.update);
    // Both chains terminate via `await chain` (no .single / .maybeSingle).
    type ThenCb = (
      onFulfilled: ((value: ChainResult<unknown>) => unknown) | null | undefined,
      onRejected: ((reason: unknown) => unknown) | null | undefined,
    ) => unknown;
    (jobsChain as unknown as PromiseLike<unknown>).then = ((
      onFulfilled,
      onRejected,
    ) =>
      Promise.resolve(opts.jobs).then(onFulfilled, onRejected)) as ThenCb as never;
    (runUpdateChain as unknown as PromiseLike<unknown>).then = ((
      onFulfilled,
      onRejected,
    ) =>
      Promise.resolve(opts.update).then(
        onFulfilled,
        onRejected,
      )) as ThenCb as never;
    return {
      from: vi.fn((table: string) => {
        if (table === "article_jobs") return jobsChain;
        if (table === "blog_autopilot_runs") return runUpdateChain;
        throw new Error(`unexpected table: ${table}`);
      }),
      __jobsChain: jobsChain,
      __runChain: runUpdateChain,
    };
  }

  it("reads jobs filtered by blog_id + input->>autopilotRunId, tallies, writes absolute counters, returns them", async () => {
    const client = makeTwoTableClient({
      jobs: {
        data: [
          { output: { wpPublish: { status: "draft_created" } } },
          { output: { wpPublish: { status: "draft_created" } } },
          { output: { wpPublish: { status: "already_sent" } } },
          { output: { wpPublish: { status: "skipped_no_connection" } } },
          { output: { wpPublish: { status: "failed" } } },
          { output: { model: "claude" } }, // no wpPublish → ignored
        ],
        error: null,
      },
      update: { data: null, error: null },
    });

    const counters = await syncAutopilotRunWordPressDraftCounters({
      runId: "run-1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(counters).toEqual({
      expected: 5,
      created: 2,
      alreadySent: 1,
      skipped: 1,
      failed: 1,
    });

    // Filter args.
    expect(client.__jobsChain.eq).toHaveBeenCalledWith("blog_id", "blog-1");
    expect(client.__jobsChain.eq).toHaveBeenCalledWith(
      "input->>autopilotRunId",
      "run-1",
    );

    // Absolute write hit blog_autopilot_runs with the right shape.
    expect(client.__runChain.update).toHaveBeenCalledWith({
      wp_drafts_expected: 5,
      wp_drafts_created: 2,
      wp_drafts_already_sent: 1,
      wp_drafts_skipped: 1,
      wp_drafts_failed: 1,
    });
    expect(client.__runChain.eq).toHaveBeenCalledWith("id", "run-1");
  });

  it("treats a null PostgREST data array as empty (defensive) + still writes zero counters", async () => {
    // PostgREST normally returns `[]` for an empty SELECT, but
    // the `?? []` guard means a stray `null` won't blow up the
    // counter sync.
    const client = makeTwoTableClient({
      jobs: { data: null, error: null },
      update: { data: null, error: null },
    });

    const counters = await syncAutopilotRunWordPressDraftCounters({
      runId: "run-1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(counters).toEqual({
      expected: 0,
      created: 0,
      alreadySent: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("writes all zeros + returns zero counters when no jobs exist", async () => {
    const client = makeTwoTableClient({
      jobs: { data: [], error: null },
      update: { data: null, error: null },
    });

    const counters = await syncAutopilotRunWordPressDraftCounters({
      runId: "run-1",
      blogId: "blog-1",
      client: client as never,
    });

    expect(counters).toEqual({
      expected: 0,
      created: 0,
      alreadySent: 0,
      skipped: 0,
      failed: 0,
    });
    expect(client.__runChain.update).toHaveBeenCalledWith({
      wp_drafts_expected: 0,
      wp_drafts_created: 0,
      wp_drafts_already_sent: 0,
      wp_drafts_skipped: 0,
      wp_drafts_failed: 0,
    });
  });

  it("is idempotent — same job set → same counters, even when called multiple times", async () => {
    const sameJobs = [
      { output: { wpPublish: { status: "draft_created" } } },
      { output: { wpPublish: { status: "failed" } } },
    ];
    const client = makeTwoTableClient({
      jobs: { data: sameJobs, error: null },
      update: { data: null, error: null },
    });

    const first = await syncAutopilotRunWordPressDraftCounters({
      runId: "run-1",
      blogId: "blog-1",
      client: client as never,
    });
    const second = await syncAutopilotRunWordPressDraftCounters({
      runId: "run-1",
      blogId: "blog-1",
      client: client as never,
    });
    expect(first).toEqual(second);
    expect(first).toEqual({
      expected: 2,
      created: 1,
      alreadySent: 0,
      skipped: 0,
      failed: 1,
    });
  });

  it("propagates jobs-query errors as-is", async () => {
    const client = makeTwoTableClient({
      jobs: { data: null, error: { message: "jobs query broke" } },
      update: { data: null, error: null },
    });

    await expect(
      syncAutopilotRunWordPressDraftCounters({
        runId: "run-1",
        blogId: "blog-1",
        client: client as never,
      }),
    ).rejects.toMatchObject({ message: "jobs query broke" });
    // No write attempted.
    expect(client.__runChain.update).not.toHaveBeenCalled();
  });

  it("falls back to the admin client when none is supplied", async () => {
    const client = makeTwoTableClient({
      jobs: { data: [], error: null },
      update: { data: null, error: null },
    });
    mockedCreateAdmin.mockReturnValueOnce(client as never);

    await syncAutopilotRunWordPressDraftCounters({
      runId: "run-1",
      blogId: "blog-1",
    });
    expect(mockedCreateAdmin).toHaveBeenCalledOnce();
  });
});
