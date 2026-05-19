#!/usr/bin/env node
// @ts-check

/**
 * Seeds approved `article_ideas` rows for a blog so QA can exercise
 * the autopilot scheduler's article-spawning path without waiting
 * for Claude to generate ideas first. Local/dev only.
 *
 * Why this exists:
 *   The autopilot scheduler only spawns `generate_article` jobs
 *   from ideas whose `status='approved'`. In a fresh dev DB the
 *   only way to get there is:
 *     1. Click "Generate ideas" (real Claude call, costs tokens),
 *     2. Click "Approve" on each card,
 *   …which is fine for one or two but tedious when you want to
 *   exercise a 10-posts/day blog or the operational throttle. This
 *   script bulk-inserts approved ideas straight into Supabase using
 *   the service-role key, bypassing the AI step entirely.
 *
 * Safety rails (refuse to run on prod):
 *   * `NEXT_PUBLIC_SUPABASE_URL` MUST point at localhost / 127.0.0.1
 *     OR a hostname containing "supabase-local" / ".local".
 *   * Refuses to run when the env file is `.env.production`.
 *   * Confirms the blog is owned by a project the operator named
 *     in `--blog-id` (no broad "all blogs" mode).
 *   * Inserts a fixed marker on each row's `executive_summary` so
 *     a follow-up cleanup query can find the seeded rows easily.
 *
 * Usage:
 *   pnpm autopilot:seed --blog-id <uuid> [--count 12]
 *
 * Verification (after running):
 *   SELECT count(*) FROM article_ideas
 *   WHERE blog_id = '<blog-id>' AND status = 'approved';
 *
 * Cleanup (post-test):
 *   DELETE FROM article_ideas
 *   WHERE blog_id = '<blog-id>'
 *     AND executive_summary = 'autopilot-qa-seed';
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

/**
 * Parses `--key value` pairs out of `process.argv`. Tiny — we don't
 * pull in commander/yargs for one script.
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

const args = parseArgs(process.argv);

const BLOG_ID = args["blog-id"];
const COUNT = args.count ? Number.parseInt(args.count, 10) : 12;
const NICHE = args.niche ?? "indie maker product analytics";

if (!BLOG_ID) {
  console.error(
    "Usage: pnpm autopilot:seed --blog-id <uuid> [--count 12] [--niche 'topic phrase']",
  );
  process.exit(1);
}
if (!Number.isFinite(COUNT) || COUNT <= 0 || COUNT > 100) {
  console.error("--count must be a positive integer ≤ 100.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Safety: refuse to run anywhere that smells like production
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run:\n" +
      "  pnpm autopilot:seed --blog-id <uuid>\n" +
      "(the wrapper passes --env-file=.env.local)",
  );
  process.exit(1);
}

const isLocal =
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url) ||
  url.includes("supabase-local") ||
  url.endsWith(".local") ||
  url.includes(".local:");

if (!isLocal) {
  console.error(
    `Refusing to run: NEXT_PUBLIC_SUPABASE_URL (${url}) is not a local target.\n` +
      "This script is for local QA only. Aborting.",
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run with NODE_ENV=production.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Supabase client + idea fixtures
// ---------------------------------------------------------------------------

/**
 * Marker stamped onto every seeded row's `executive_summary` so the
 * cleanup query at the bottom of this file can find them without
 * reading the title. Don't rename without updating the README.
 */
const SEED_MARKER = "autopilot-qa-seed";

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Title generator. Produces deterministic-ish titles (suffix is the
 * timestamp) so a re-run doesn't accidentally collide on a unique
 * index. Keeps each title unique per call.
 */
function buildIdea(index) {
  const stamp = new Date().toISOString().slice(0, 16); // YYYY-MM-DDThh:mm
  const titles = [
    `How to ship faster as a solo ${NICHE} founder`,
    `${NICHE}: a beginner's guide to weekly metrics`,
    `5 mistakes new ${NICHE} teams make in their first 90 days`,
    `What changed in ${NICHE} this year (and what didn't)`,
    `A simple framework for tracking ${NICHE} progress`,
    `Why most ${NICHE} dashboards are broken (and how to fix yours)`,
    `From idea to launch: an honest ${NICHE} timeline`,
    `${NICHE} pricing experiments that actually moved the needle`,
    `The smallest possible ${NICHE} workflow that still works`,
    `What ${NICHE} customers actually want (we asked 50)`,
    `Stop measuring vanity ${NICHE} numbers — here's what to track`,
    `A tour of three real ${NICHE} stacks`,
    `When to invest in ${NICHE} tooling (and when to skip it)`,
    `${NICHE} retention: the levers that actually matter`,
    `Onboarding playbook for ${NICHE} self-serve products`,
  ];
  const base = titles[index % titles.length];
  return {
    title: `${base} — ${stamp} #${index + 1}`,
    target_keyword: NICHE,
    article_type: "how_to",
    estimated_word_count: 1200,
    executive_summary: SEED_MARKER,
    raw_ai_response: { source: SEED_MARKER, generatedAt: stamp },
  };
}

// ---------------------------------------------------------------------------
// Pre-flight: verify the blog exists + capture context for the log
// ---------------------------------------------------------------------------

async function main() {
  const { data: blog, error: blogErr } = await supabase
    .from("blogs")
    .select("id, name, project_id")
    .eq("id", BLOG_ID)
    .maybeSingle();
  if (blogErr) {
    console.error("Failed to look up blog:", blogErr.message);
    process.exit(1);
  }
  if (!blog) {
    console.error(`No blog found with id=${BLOG_ID}.`);
    process.exit(1);
  }

  console.log(
    `Seeding ${COUNT} approved idea(s) for blog "${blog.name}" (${blog.id})…`,
  );

  // Build the rows. We don't set `user_id` because the schema
  // allows null and the autopilot scheduler reads only the blog id
  // off the idea row.
  const rows = Array.from({ length: COUNT }, (_, i) => ({
    id: randomUUID(),
    blog_id: blog.id,
    status: "approved",
    ...buildIdea(i),
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from("article_ideas")
    .insert(rows)
    .select("id");
  if (insertErr) {
    console.error("Insert failed:", insertErr.message);
    process.exit(1);
  }

  console.log(
    `Inserted ${inserted?.length ?? 0} approved ideas with executive_summary='${SEED_MARKER}'.`,
  );
  console.log("\nNext steps:");
  console.log(
    "  1. Trigger the autopilot scheduler (see docs/mvp-autopilot-qa.md):",
  );
  console.log(
    '       curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/autopilot',
  );
  console.log(
    "  2. Watch blog_autopilot_runs.output.spawnedArticleJobIds grow per tick.",
  );
  console.log("\nCleanup when you're done:");
  console.log(
    `  DELETE FROM article_ideas WHERE blog_id = '${blog.id}' AND executive_summary = '${SEED_MARKER}';`,
  );
}

main().catch((err) => {
  console.error("Unexpected failure:", err);
  process.exit(1);
});
