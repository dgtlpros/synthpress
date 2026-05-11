import { NextResponse, type NextRequest } from "next/server";
import { runBlogAutopilotScheduler } from "@/services/autopilot-scheduler-service";

/**
 * Autopilot scheduler entry point.
 *
 * Invoked by Vercel Cron (or manually via `curl` with the secret).
 * Loads up to N blogs with armed autopilot
 * (`settings.automation.mode='autopilot' AND .enabled=true`) and
 * ticks each one through the scheduler:
 *   * tops up the approved-idea backlog when below the configured
 *     threshold,
 *   * spawns `generate_article` workflows for approved ideas, capped
 *     by `maxPostsPerDay`, `generatePerWeek`, the team's token
 *     balance, and an optional per-blog `dailyTokenBudget`.
 *
 * Every per-blog tick records a row in `blog_autopilot_runs` so the
 * future ops drawer can audit what the scheduler decided.
 *
 * Auth: same pattern as `/api/cron/reconcile-article-jobs` —
 * `Authorization: Bearer ${CRON_SECRET}` or 401.
 *
 * Vercel Cron supports both GET and POST. Accept GET so the default
 * cron config (which sends GET) works without extra setup, and POST
 * for manual invocations from scripts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Optional `?dry_run=true` lets operators see what the scheduler
  // WOULD do without actually spawning workflows or generating
  // ideas. Useful right after enabling autopilot for a blog.
  const dryRun =
    request.nextUrl.searchParams.get("dry_run") === "true";

  try {
    const result = await runBlogAutopilotScheduler({ dryRun });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown autopilot failure.";
    return NextResponse.json(
      { error: `Autopilot failed: ${message}` },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
