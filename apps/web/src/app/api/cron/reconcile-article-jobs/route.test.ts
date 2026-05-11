import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/article-generation-service", () => ({
  reconcileStuckArticleJobs: vi.fn(),
}));

import { reconcileStuckArticleJobs } from "@/services/article-generation-service";
import { GET, POST } from "./route";

const mockedReconcile = vi.mocked(reconcileStuckArticleJobs);

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  mockedReconcile.mockReset();
  mockedReconcile.mockResolvedValue({
    jobsChecked: 0,
    jobsFailed: 0,
    articlesFailed: 0,
    tokensRefunded: 0,
    errors: [],
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

function makeRequest(authorization?: string): never {
  // We only touch `request.headers.get(...)` in the handler, so a
  // tiny stand-in is enough — typed as `never` so the route accepts
  // it without dragging in the real NextRequest constructor.
  const headers = new Headers();
  if (authorization !== undefined) {
    headers.set("authorization", authorization);
  }
  return { headers } as unknown as never;
}

describe("/api/cron/reconcile-article-jobs", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/CRON_SECRET is not configured/);
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it("rejects missing Authorization with 401", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it("rejects an Authorization with the wrong secret with 401", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it("rejects an Authorization without the Bearer prefix with 401", async () => {
    const res = await GET(makeRequest("test-secret"));
    expect(res.status).toBe(401);
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it("returns the reconciler result on a valid GET", async () => {
    mockedReconcile.mockResolvedValueOnce({
      jobsChecked: 3,
      jobsFailed: 2,
      articlesFailed: 2,
      tokensRefunded: 7,
      errors: ["job_x: oops"],
    });

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      jobsChecked: 3,
      jobsFailed: 2,
      articlesFailed: 2,
      tokensRefunded: 7,
      errors: ["job_x: oops"],
    });
    expect(mockedReconcile).toHaveBeenCalledOnce();
  });

  it("supports POST as well as GET (manual invocations / Vercel Cron compat)", async () => {
    const res = await POST(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(mockedReconcile).toHaveBeenCalledOnce();
  });

  it("returns 500 with a friendly message when the reconciler throws", async () => {
    mockedReconcile.mockRejectedValueOnce(new Error("supabase down"));
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/supabase down/);
  });

  it("falls back to a generic message on a non-Error throw", async () => {
    mockedReconcile.mockRejectedValueOnce("plain-string-failure");
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown reconciler failure/);
  });
});
