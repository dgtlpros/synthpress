import { NextResponse, type NextRequest } from "next/server";
import { reconcileStuckArticleJobs } from "@/services/article-generation-service";

/**
 * Reconciler entry point for the workflow safety net.
 *
 * Invoked by Vercel Cron (or manually via `curl` with the secret).
 * Finds `article_jobs` rows that have been stuck in pending /
 * processing past their type's stale threshold, marks them failed,
 * marks the in-flight article failed, and refunds any consumed
 * credits via the token ledger.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` to match the
 * env var. Vercel Cron sends this header automatically; manual
 * callers from a terminal pass it explicitly. Anything else gets a
 * 401.
 *
 * Vercel Cron supports both GET and POST. We accept GET so the
 * Vercel default cron config (which sends GET) works without extra
 * setup, and POST for manual invocations from scripts that prefer
 * not to leak the secret in URLs / shell history.
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

  try {
    const result = await reconcileStuckArticleJobs();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown reconciler failure.";
    return NextResponse.json(
      { error: `Reconciler failed: ${message}` },
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
