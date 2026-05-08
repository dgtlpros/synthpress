import "server-only";

import { generateText, NoObjectGeneratedError, Output } from "ai";
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { BlogSettings } from "@/lib/blog-settings";
import { getModelForTask } from "./models";

/**
 * The provider boundary.
 *
 * This file is intentionally the ONLY place in the codebase that
 * imports `ai` or `@ai-sdk/anthropic`. Everything else — server
 * actions, generation orchestration, future Vercel Workflow steps —
 * calls the narrow functions exported below.
 *
 * Why a thin boundary:
 *   * Switching providers (OpenAI, Gemini, a self-hosted model) becomes
 *     a one-file change instead of a grep-and-rewrite.
 *   * Tests for the orchestration layer mock a typed function instead
 *     of stubbing the SDK, which keeps them fast and stable across SDK
 *     upgrades.
 *
 * Why server-only:
 *   `ANTHROPIC_API_KEY` MUST never be bundled into client code. The
 *   `import "server-only"` directive makes the Next.js build fail
 *   loudly if a `"use client"` module ever transitively pulls this in.
 *
 * What this file is NOT responsible for:
 *   * Token / credit deduction — the orchestration calls
 *     `consumeTeamTokens(...)` separately, with `getCreditCost(...)`.
 *   * `article_jobs` persistence — that's `article-generation-service`.
 *   * `usage_events` logging — same.
 *   * Retry / streaming — added later when we move into Vercel
 *     Workflows.
 *
 * Implementation note: AI SDK 6 deprecated `generateObject` in favor
 * of `generateText({ output: Output.object(...) })`. We use the new
 * path so a future SDK bump doesn't bite us.
 */

/**
 * Lazy provider factory — uses the default `anthropic` provider unless
 * the caller injects one (used by tests and any future per-tenant key
 * rotation). Reads `ANTHROPIC_API_KEY` from the environment via the
 * SDK; we never reference the env var by name in app code.
 */
export type AnthropicLike = typeof anthropic;

/**
 * Re-exported so callers can type-narrow on it without importing `ai`.
 * Useful for the orchestration code's "should this fail the job?"
 * branch.
 */
export { NoObjectGeneratedError };

/**
 * Resolves the anthropic provider to use. Defaults to the SDK's
 * env-driven singleton; callers may inject a custom one (tests, or a
 * future "per-tenant API key" feature).
 */
export function resolveAnthropic(provider?: AnthropicLike): AnthropicLike {
  return provider ?? anthropic;
}

/**
 * Creates a fresh Anthropic provider with an explicit API key. The
 * orchestration / cron flows shouldn't need this — the env-driven
 * default works — but it's the supported escape hatch.
 */
export function createAnthropicProvider(apiKey: string): AnthropicLike {
  return createAnthropic({ apiKey });
}

// ----------------------------------------------------------------------------
// Article ideas (the v1 boundary that powers the "Generate ideas" flow —
// manual today, autopilot / cron / workflow tomorrow)
// ----------------------------------------------------------------------------

/**
 * v1 default batch size — matches the placeholder values the
 * orchestration uses when the caller doesn't specify a count. Lives
 * here (not in `config.ts`) because it's intrinsic to the provider's
 * prompt — Claude is told "generate {count} ideas" — rather than a
 * pricing knob.
 */
export const IDEA_DEFAULT_COUNT = 10;

/**
 * The same ARTICLE_TYPE_OPTIONS that the blog settings UI exposes to
 * the user. Listing them in the prompt forces Claude to pick from the
 * known set rather than inventing new types that the UI can't render.
 */
const IDEA_ARTICLE_TYPES = [
  "how_to",
  "listicle",
  "comparison",
  "review",
  "news",
  "opinion",
  "tutorial",
  "case_study",
] as const;

const ideaSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "slug must be lowercase-hyphenated",
    )
    .max(120),
  targetKeyword: z.string().min(1).max(120),
  executiveSummary: z.string().min(20).max(500),
  articleType: z.enum(IDEA_ARTICLE_TYPES),
  estimatedWordCount: z.int().positive().max(10_000),
});

const ideasResponseSchema = z.object({
  ideas: z.array(ideaSchema).min(1),
});

export type GeneratedIdea = z.infer<typeof ideaSchema>;

export interface GeneratedIdeasBatch {
  ideas: GeneratedIdea[];
  /** Echoed back so the caller can stamp it on `usage_events` / `article_jobs.output`. */
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedReadTokens: number | null;
  cachedWriteTokens: number | null;
}

export interface GenerateIdeasInput {
  blogName: string;
  blogDescription?: string;
  settings: BlogSettings;
  /** Optional topic / brief from the user. Empty/whitespace is treated as absent. */
  brief?: string;
  /** How many ideas to ask for. Defaults to {@link IDEA_DEFAULT_COUNT}. */
  count?: number;
  /**
   * Existing titles the model should avoid (de-dupe pass). Empty array
   * is fine; we just don't emit the "avoid" line.
   */
  existingTitles?: string[];
  /** Override the model. Defaults to the configured `ideaGeneration` model. */
  model?: string;
  /** Inject a custom Anthropic provider (tests, per-tenant keys). */
  anthropicProvider?: AnthropicLike;
}

/**
 * Generates a batch of article ideas. Pure with respect to our DB —
 * does not touch Supabase. The orchestration layer
 * (`article-generation-service.generateArticleIdeas`) owns the job row,
 * the credit deduction, and the `article_ideas` insert.
 *
 * Throws:
 *   * `NoObjectGeneratedError` — Claude's output didn't fit the schema.
 *   * Other SDK errors (network, auth, rate limit) — propagated as-is.
 */
export async function generateIdeas(
  input: GenerateIdeasInput,
): Promise<GeneratedIdeasBatch> {
  const provider = resolveAnthropic(input.anthropicProvider);
  const modelId = input.model ?? getModelForTask("ideaGeneration");
  const count = input.count ?? IDEA_DEFAULT_COUNT;
  const { system, prompt } = buildIdeasPromptParts({ ...input, count });

  const result = await generateText({
    model: provider(modelId),
    output: Output.object({
      schema: ideasResponseSchema,
      name: "article_ideas_batch",
      description: `A batch of ${count} fresh article ideas for the configured blog.`,
    }),
    system,
    prompt,
  });

  return {
    ideas: result.output.ideas,
    model: modelId,
    promptTokens: result.usage.inputTokens ?? null,
    completionTokens: result.usage.outputTokens ?? null,
    cachedReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? null,
    cachedWriteTokens:
      result.usage.inputTokenDetails.cacheWriteTokens ?? null,
  };
}

/**
 * Splits prompt construction out of {@link generateIdeas} so tests can
 * assert that the brief / existing-titles / settings flow into the
 * prompt without spinning up a fake AI SDK. Exported only for tests;
 * treat as an implementation detail outside this file.
 */
export function buildIdeasPromptParts(
  input: GenerateIdeasInput & { count: number },
): { system: string; prompt: string } {
  const { blogName, blogDescription, settings, brief, count, existingTitles } =
    input;
  const { identity, strategy, ai, advanced } = settings;

  const goalsLine = strategy.goals.length
    ? strategy.goals.join(", ")
    : "general thought leadership";

  const articleTypesLine = strategy.preferredArticleTypes.length
    ? strategy.preferredArticleTypes.join(", ")
    : "any of the supported types";

  const customSystemAddendum = advanced.customSystemPrompt.trim()
    ? `\n\nAdditional instructions from the blog owner:\n${advanced.customSystemPrompt.trim()}`
    : "";

  const positivePromptLine = ai.positivePrompt.trim()
    ? `\n- DO: ${ai.positivePrompt.trim()}`
    : "";
  const negativePromptLine = ai.negativePrompt.trim()
    ? `\n- DO NOT: ${ai.negativePrompt.trim()}`
    : "";

  const system = [
    `You are a senior content strategist generating fresh article ideas for a blog called "${blogName}".`,
    blogDescription?.trim()
      ? `Blog description: ${blogDescription.trim()}`
      : null,
    `Target audience: ${identity.audience || "a general professional audience"}.`,
    `Tone: ${identity.tone || "professional, clear, friendly"}.`,
    `Editorial goals: ${goalsLine}.`,
    `Preferred article formats: ${articleTypesLine}.`,
    positivePromptLine,
    negativePromptLine,
    `Each idea must be specific enough to write a full article from. Avoid vague headlines like "Tips for Success".${customSystemAddendum}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const briefLine = brief?.trim()
    ? `Topic seed from the user (use it as inspiration, but feel free to extend in directions that fit the blog's strategy):\n"""\n${brief.trim()}\n"""`
    : `No specific topic seed was provided. Pick on-strategy topics that fit the blog's content goals (${goalsLine}) and target audience.`;

  const topicsCoverLine = strategy.topicsToCover.trim()
    ? `Topics the blog wants covered: ${strategy.topicsToCover.trim()}.`
    : "";
  const topicsAvoidLine = strategy.topicsToAvoid.trim()
    ? `Topics to avoid: ${strategy.topicsToAvoid.trim()}.`
    : "";

  const existingTitlesLine =
    existingTitles && existingTitles.length > 0
      ? `Avoid duplicating any of these existing post titles:\n${existingTitles.map((t) => `- ${t}`).join("\n")}`
      : "";

  const prompt = [
    `Generate exactly ${count} distinct article ideas.`,
    briefLine,
    topicsCoverLine,
    topicsAvoidLine,
    existingTitlesLine,
    "Each idea must include:",
    "- title: an SEO-friendly, click-worthy headline (no clickbait).",
    "- slug: a lowercase-hyphenated URL slug derived from the title.",
    "- targetKeyword: the primary keyword the article would target.",
    "- executiveSummary: 2-3 sentences describing what the article will cover and why a reader should care.",
    `- articleType: one of ${IDEA_ARTICLE_TYPES.join(", ")}.`,
    "- estimatedWordCount: an integer estimate of the finished article's length.",
    `Return a JSON object with one key, "ideas", containing exactly ${count} entries.`,
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");

  return { system, prompt };
}

// ----------------------------------------------------------------------------
// Article draft generation (the v1 boundary the manual flow will call)
// ----------------------------------------------------------------------------

/**
 * Strict Zod schema for the generated article. Keeping it strict means
 * malformed responses raise a `NoObjectGeneratedError` in the SDK
 * before our orchestration sees them — when we get a draft back, every
 * required field is present and well-formed.
 */
const articleDraftSchema = z.object({
  title: z
    .string()
    .min(1, "title is required")
    .max(200, "title must be 200 chars or fewer"),
  slug: z
    .string()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "slug must be lowercase-hyphenated",
    )
    .max(120),
  excerpt: z.string().min(1).max(500),
  metaDescription: z.string().min(1).max(200),
  contentMarkdown: z
    .string()
    .min(100, "article body must be at least 100 chars"),
  targetKeyword: z.string().min(1).max(120),
  wordCount: z.int().positive(),
  outline: z
    .array(
      z.object({
        heading: z.string().min(1),
        summary: z.string().min(1),
      }),
    )
    .min(1),
});

export type GeneratedArticleDraft = z.infer<typeof articleDraftSchema> & {
  /** The model id that produced the draft (echoed back for audit logs). */
  model: string;
  /** Token counts. `null` when the provider did not report them. */
  promptTokens: number | null;
  completionTokens: number | null;
  cachedReadTokens: number | null;
  cachedWriteTokens: number | null;
};

export interface GenerateArticleDraftInput {
  blogName: string;
  blogDescription?: string;
  settings: BlogSettings;
  /** Optional topic / brief from the user. Empty/whitespace is treated as absent. */
  brief?: string;
  /** Override the model. Defaults to the configured `articleGeneration` model. */
  model?: string;
  /** Inject a custom Anthropic provider (tests, per-tenant keys). */
  anthropicProvider?: AnthropicLike;
}

/**
 * Generates a single article draft. Pure with respect to our DB —
 * does not touch Supabase. The orchestration layer owns placeholder
 * rows, job tracking, and credit deduction.
 *
 * Throws:
 *   * `NoObjectGeneratedError` — Claude produced text that doesn't fit
 *     the schema (missing field, slug malformed, etc.).
 *   * Any other SDK error (network, auth, rate limit) — propagated as
 *     is so the caller can decide whether to retry / refund credits.
 */
export async function generateArticleDraft(
  input: GenerateArticleDraftInput,
): Promise<GeneratedArticleDraft> {
  const provider = resolveAnthropic(input.anthropicProvider);
  const modelId = input.model ?? getModelForTask("articleGeneration");
  const { system, prompt } = buildArticlePromptParts(input);

  const result = await generateText({
    model: provider(modelId),
    output: Output.object({
      schema: articleDraftSchema,
      name: "article_draft",
      description: "A single article draft for the configured blog.",
    }),
    system,
    prompt,
  });

  return {
    ...result.output,
    model: modelId,
    promptTokens: result.usage.inputTokens ?? null,
    completionTokens: result.usage.outputTokens ?? null,
    cachedReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? null,
    cachedWriteTokens:
      result.usage.inputTokenDetails.cacheWriteTokens ?? null,
  };
}

/**
 * Splits prompt construction out of {@link generateArticleDraft} so
 * tests can assert that the user-facing brief makes it into the prompt
 * without spinning up a fake AI SDK. Exported only for tests; treat as
 * an implementation detail outside this file.
 */
export function buildArticlePromptParts(
  input: GenerateArticleDraftInput,
): { system: string; prompt: string } {
  const { blogName, blogDescription, settings, brief } = input;
  const { identity, strategy, ai, seo, advanced } = settings;

  const goalsLine = strategy.goals.length
    ? strategy.goals.join(", ")
    : "general thought leadership";

  const articleTypesLine = strategy.preferredArticleTypes.length
    ? strategy.preferredArticleTypes.join(", ")
    : "no specific format preference";

  const customSystemAddendum = advanced.customSystemPrompt.trim()
    ? `\n\nAdditional instructions from the blog owner:\n${advanced.customSystemPrompt.trim()}`
    : "";

  const positivePromptLine = ai.positivePrompt.trim()
    ? `\n- DO: ${ai.positivePrompt.trim()}`
    : "";
  const negativePromptLine = ai.negativePrompt.trim()
    ? `\n- DO NOT: ${ai.negativePrompt.trim()}`
    : "";

  const system = [
    `You are a senior content writer producing a single Markdown article for a blog called "${blogName}".`,
    blogDescription?.trim()
      ? `Blog description: ${blogDescription.trim()}`
      : null,
    `Target audience: ${identity.audience || "a general professional audience"}.`,
    `Tone: ${identity.tone || "professional, clear, friendly"}.`,
    `Reading level: ${identity.readingLevel}. Point of view: ${identity.pointOfView.replace(/_/g, " ")}.`,
    `Writing language: ${identity.language}.`,
    `Editorial goals: ${goalsLine}.`,
    `Preferred article formats: ${articleTypesLine}.`,
    `Target article length (approximate): ${seo.defaultArticleLength} words.`,
    `SEO keyword usage discipline: ${seo.keywordUsage}.`,
    `Slug format: ${seo.slugFormat}.`,
    positivePromptLine,
    negativePromptLine,
    `Your response must conform to the provided JSON schema. Write the article body as Markdown (headings with #, lists with -, links with [text](url)). Do NOT wrap the Markdown in code fences. Do NOT include front-matter.${customSystemAddendum}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const briefLine = brief?.trim()
    ? `The user provided this topic / brief:\n"""\n${brief.trim()}\n"""\n\nUse it as the primary subject of the article.`
    : `No specific topic was provided. Pick a fresh, on-strategy topic that fits the blog's content goals (${goalsLine}) and target audience. Avoid topics that obviously duplicate existing posts.`;

  const topicsCoverLine = strategy.topicsToCover.trim()
    ? `Topics the blog wants covered: ${strategy.topicsToCover.trim()}.`
    : "";
  const topicsAvoidLine = strategy.topicsToAvoid.trim()
    ? `Topics to avoid: ${strategy.topicsToAvoid.trim()}.`
    : "";

  const prompt = [
    briefLine,
    topicsCoverLine,
    topicsAvoidLine,
    "Return a JSON object matching the schema, with:",
    "- title: an SEO-friendly, click-worthy headline (no clickbait).",
    "- slug: a lowercase-hyphenated URL slug derived from the title.",
    "- excerpt: a 1-2 sentence summary suitable for a card preview.",
    "- metaDescription: a search-engine meta description (~155 chars).",
    "- contentMarkdown: the full article in Markdown, with H2/H3 headings.",
    "- targetKeyword: the primary keyword the article targets.",
    "- wordCount: an integer count of words in contentMarkdown.",
    "- outline: an array of {heading, summary} entries mirroring the H2 sections of the article.",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");

  return { system, prompt };
}
