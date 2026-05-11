import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/autopilot-scheduler-service", () => ({
  runBlogAutopilotScheduler: vi.fn(),
}));

import { runBlogAutopilotScheduler } from "@/services/autopilot-scheduler-service";
import { GET, POST } from "./route";

const mockedRun = vi.mocked(runBlogAutopilotScheduler);

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  mockedRun.mockReset();
  mockedRun.mockResolvedValue({
    blogsChecked: 0,
    runsCreated: 0,
    runsSkipped: 0,
    runsFailed: 0,
    ideasGenerated: 0,
    articleJobsStarted: 0,
    errors: [],
    perBlog: [],
  });
  process.env.CRON_SECRET = "test-secret";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  }
});

function makeRequest(opts: {
  authorization?: string;
  searchParams?: Record<string, string>;
}): never {
  const headers = new Headers();
  if (opts.authorization !== undefined) {
    headers.set("authorization", opts.authorization);
  }
  const params = new URLSearchParams(opts.searchParams ?? {});
  // Tiny stand-in — the route only touches `headers.get(...)` and
  // `nextUrl.searchParams.get(...)`. Typed as `never` so the route
  // accepts it without dragging in the real NextRequest.
  return {
    headers,
    nextUrl: { searchParams: params },
  } as unknown as never;
}

describe("/api/cron/autopilot", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest({ authorization: "Bearer anything" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/CRON_SECRET is not configured/);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("rejects missing Authorization with 401", async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(401);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("rejects an Authorization with the wrong secret with 401", async () => {
    const res = await GET(makeRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("rejects an Authorization without the Bearer prefix with 401", async () => {
    const res = await GET(makeRequest({ authorization: "test-secret" }));
    expect(res.status).toBe(401);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns the scheduler summary on a valid GET", async () => {
    mockedRun.mockResolvedValueOnce({
      blogsChecked: 3,
      runsCreated: 1,
      runsSkipped: 2,
      runsFailed: 0,
      ideasGenerated: 4,
      articleJobsStarted: 1,
      errors: [],
      perBlog: [
        {
          blogId: "b1",
          runId: "r1",
          status: "completed",
          articleJobsStarted: 1,
          ideasGenerated: 0,
        },
      ],
    });

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blogsChecked).toBe(3);
    expect(body.articleJobsStarted).toBe(1);
    expect(body.perBlog).toHaveLength(1);
    expect(mockedRun).toHaveBeenCalledOnce();
    expect(mockedRun).toHaveBeenCalledWith({ dryRun: false });
  });

  it("supports POST as well as GET (Vercel Cron compat / manual invocations)", async () => {
    const res = await POST(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(200);
    expect(mockedRun).toHaveBeenCalledOnce();
  });

  it("forwards dry_run=true from the query string into the scheduler", async () => {
    const res = await GET(
      makeRequest({
        authorization: "Bearer test-secret",
        searchParams: { dry_run: "true" },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockedRun).toHaveBeenCalledWith({ dryRun: true });
  });

  it("treats dry_run values other than 'true' as not-dry-run", async () => {
    const res = await GET(
      makeRequest({
        authorization: "Bearer test-secret",
        searchParams: { dry_run: "1" },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockedRun).toHaveBeenCalledWith({ dryRun: false });
  });

  it("returns 500 with a friendly message when the scheduler throws", async () => {
    mockedRun.mockRejectedValueOnce(new Error("scheduler crashed"));
    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/scheduler crashed/);
  });

  it("falls back to a generic message on a non-Error throw", async () => {
    mockedRun.mockRejectedValueOnce("plain-string-failure");
    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown autopilot failure/);
  });
});
