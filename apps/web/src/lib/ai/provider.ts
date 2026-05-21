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
 * Message patterns the AI SDK uses when Claude returns text that
 * doesn't fit the schema. We grep against these as a forward-compat
 * fallback — the typed `NoObjectGeneratedError` instance check is
 * the primary path, but a future SDK upgrade could re-throw the
 * same failure under a different class name (or wrapped in a
 * generic `Error`) and we still want to recognize it.
 *
 * Patterns are deliberately narrow: "auth failed", "rate limited",
 * "ECONNRESET", and other transient/provider issues do NOT match.
 * That keeps {@link isStructuredArticleGenerationSchemaError} from
 * triggering the retry path on errors that won't be fixed by a
 * stricter prompt.
 */
const SCHEMA_ERROR_MESSAGE_PATTERNS: readonly RegExp[] = [
  /\bno object generated\b/i,
  /\bresponse did not match (the )?schema\b/i,
  /\bschema validation (failed|failure)\b/i,
  /\binvalid structured output\b/i,
];

/** Single prompt bullet when `value` is non-empty; otherwise `""`. */
function settingBullet(label: string, value: string): string {
  const trimmed = value.trim();
  return trimmed ? `\n- ${label}: ${trimmed}` : "";
}

function internalLinkingGuidance(
  preference: BlogSettings["seo"]["internalLinkingPreference"],
): string {
  if (preference === "none") return "";
  const intensity = preference === "aggressive" ? "several" : "occasional";
  return `\n- Internal links: Include ${intensity} Markdown internal-link placeholders like [descriptive anchor](/topic-slug-hint) where natural. Use slug hints only — do not invent full URLs or claim pages exist.`;
}

function externalLinkingGuidance(
  preference: BlogSettings["seo"]["externalLinkingPreference"],
): string {
  if (preference === "none") return "";
  const intensity =
    preference === "aggressive"
      ? "You may frequently suggest"
      : "You may occasionally suggest";
  return `\n- External references: ${intensity} linking to authoritative third-party sources in prose when helpful, but do not invent specific URLs, citations, or statistics.`;
}

function formatBlogKeywordsList(keywords: string[] | undefined): string {
  if (!keywords?.length) return "";
  const list = keywords.map((k) => k.trim()).filter(Boolean);
  return list.length ? list.join(", ") : "";
}

function legacyAiPromptAddendum(
  legacyTemplate: string | undefined,
  customSystemPrompt: string,
): string {
  const legacy = legacyTemplate?.trim();
  if (!legacy) return "";
  const priorityNote = customSystemPrompt.trim()
    ? " (lower priority than Advanced → Custom system prompt above)"
    : "";
  return `\n\nLegacy blog-level prompt guidance${priorityNote}:\n${legacy}`;
}

/**
 * Returns `true` when an error from the AI SDK is a structured-
 * output schema validation failure (Claude produced text that
 * doesn't fit the requested Zod schema). Used by both:
 *
 *   * {@link generateArticleDraft} — to decide whether to retry
 *     with a stricter repair instruction before bubbling up.
 *   * `runGenerateArticleFromIdeaJob` — to stamp `failureKind:
 *     "schema_mismatch"` + retry metadata onto
 *     `article_jobs.output` before failing the job.
 *
 * Narrowness contract: this MUST NOT match generic provider
 * errors (auth, rate limit, network) and MUST NOT match
 * truncation errors (those have their own
 * {@link isTruncatedArticleOutputError} recognizer + a different
 * `failureKind`). Unit tests in `provider.test.ts` regex-pin both
 * directions.
 */
export function isStructuredArticleGenerationSchemaError(
  err: unknown,
): boolean {
  if (err instanceof NoObjectGeneratedError) return true;
  if (err instanceof SchemaRetryFailedError) return true;
  if (err instanceof TruncatedArticleOutputError) return false;
  if (err instanceof TruncationRetryFailedError) return false;
  if (err instanceof Error) {
    return SCHEMA_ERROR_MESSAGE_PATTERNS.some((pat) => pat.test(err.message));
  }
  return false;
}

/**
 * Returns `true` when an article generation error is a truncation
 * failure (Claude produced a valid-looking JSON object but the
 * body was cut off — see {@link assertArticleNotTruncated} for
 * the full detection rules).
 *
 * Mirrors {@link isStructuredArticleGenerationSchemaError}: the
 * orchestrator uses it to stamp `failureKind: "truncated_output"`
 * with retry / detection metadata onto `article_jobs.output`
 * before failing the job. Stays orthogonal to the schema
 * recognizer so a future SDK change that conflates the two never
 * silently mislabels a job.
 */
export function isTruncatedArticleOutputError(err: unknown): boolean {
  return (
    err instanceof TruncatedArticleOutputError ||
    err instanceof TruncationRetryFailedError
  );
}

/**
 * Discriminator for the orchestrator's failure-metadata stamp.
 * Returns the structured `failureKind` to record on
 * `article_jobs.output`, or `null` when the error is not one of
 * the recognized article-generation failures (caller should fall
 * through to the generic refund + fail-marking path).
 */
export function getArticleGenerationFailureKind(
  err: unknown,
): "schema_mismatch" | "truncated_output" | null {
  if (isTruncatedArticleOutputError(err)) return "truncated_output";
  if (isStructuredArticleGenerationSchemaError(err)) return "schema_mismatch";
  return null;
}

/**
 * Thrown by {@link assertArticleNotTruncated} when a single
 * Claude attempt produced a structured-output JSON whose body
 * looks truncated. Detected in two ways (either triggers):
 *
 *   1. The AI SDK reported `finishReason === "length"` — Claude
 *      hit our explicit {@link ARTICLE_MAX_OUTPUT_TOKENS} cap, OR
 *      the model's own max. Either way the response is incomplete
 *      by definition.
 *   2. The actual word count of `contentMarkdown` is below
 *      {@link ARTICLE_TRUNCATION_WORD_FLOOR} AND is less than
 *      {@link ARTICLE_TRUNCATION_RATIO_THRESHOLD} × the model's
 *      self-reported `wordCount`. Catches the "Claude said 2180
 *      words, wrote 140" provider-side hiccup we hit in prod.
 *
 * Like {@link NoObjectGeneratedError}, this is a *retriable*
 * structured-output failure — {@link generateArticleDraft} runs
 * one second attempt before giving up. If both attempts truncate,
 * {@link TruncationRetryFailedError} surfaces upward so the
 * orchestrator can stamp `failureKind: "truncated_output"` +
 * refund.
 */
export class TruncatedArticleOutputError extends Error {
  readonly kind = "truncated_output" as const;
  readonly actualWords: number;
  readonly expectedWords: number;
  readonly finishReason: string | null;
  /** First ~160 chars of the truncated body — for ops debugging in logs. */
  readonly contentMarkdownPreview: string;

  constructor(opts: {
    actualWords: number;
    expectedWords: number;
    finishReason: string | null;
    contentMarkdownPreview: string;
  }) {
    super(
      `Article generation produced a truncated body (` +
        `finishReason=${opts.finishReason ?? "unknown"}, ` +
        `actualWords=${opts.actualWords}, ` +
        `expectedWords=${opts.expectedWords}).`,
    );
    this.name = "TruncatedArticleOutputError";
    this.actualWords = opts.actualWords;
    this.expectedWords = opts.expectedWords;
    this.finishReason = opts.finishReason;
    this.contentMarkdownPreview = opts.contentMarkdownPreview;
  }
}

/**
 * Thrown by {@link generateArticleDraft} when BOTH the first
 * attempt and the schema-repair retry hit a truncation
 * ({@link TruncatedArticleOutputError}). Carries both errors so
 * the orchestrator can stamp a structured failure record onto
 * the job before refunding tokens.
 *
 * Why a dedicated class (mirroring {@link SchemaRetryFailedError}):
 *   * The orchestrator branches on the class to stamp
 *     `failureKind: "truncated_output"` vs `"schema_mismatch"`
 *     so operators can see at a glance which failure mode hit.
 *   * `getArticleGenerationFailureKind` returns the right
 *     discriminator without re-grepping the message.
 *   * Future autopilot drawer / support tooling can render
 *     "Truncation retry failed" copy distinct from schema
 *     failures.
 */
export class TruncationRetryFailedError extends Error {
  readonly kind = "truncated_output" as const;
  readonly retried = true as const;
  readonly retryCount: number;
  readonly originalError: TruncatedArticleOutputError;
  readonly retryError: TruncatedArticleOutputError;
  readonly originalErrorMessage: string;
  readonly finalErrorMessage: string;

  constructor(opts: {
    originalError: TruncatedArticleOutputError;
    retryError: TruncatedArticleOutputError;
    retryCount: number;
  }) {
    const originalErrorMessage = opts.originalError.message;
    const finalErrorMessage = opts.retryError.message;
    super(
      `Article truncation retry failed (attempt ${opts.retryCount + 1}). ` +
        `Original: ${originalErrorMessage} Final: ${finalErrorMessage}`,
    );
    this.name = "TruncationRetryFailedError";
    this.retryCount = opts.retryCount;
    this.originalError = opts.originalError;
    this.retryError = opts.retryError;
    this.originalErrorMessage = originalErrorMessage;
    this.finalErrorMessage = finalErrorMessage;
  }
}

/**
 * Counts whitespace-separated words in an article body. Cheap
 * approximation that's good enough for the truncation check —
 * we're comparing against a model self-report that's also a
 * rough count, and looking for >2× divergence (not 1% drift).
 */
export function countArticleBodyWords(contentMarkdown: string): number {
  const trimmed = contentMarkdown.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Inspects an article draft + its provider finishReason and
 * throws {@link TruncatedArticleOutputError} when the body looks
 * cut off. See the error class jsdoc for the full detection
 * rules.
 *
 * Side effect: emits a single `console.warn` with structured
 * detection metadata when a truncation is detected. The
 * orchestrator persists the same metadata on
 * `article_jobs.output.truncationDetection` for after-the-fact
 * triage, but having the warn in the provider layer keeps the
 * signal close to the SDK call so it shows up in Vercel logs
 * even when DB writes fail downstream.
 */
export function assertArticleNotTruncated(
  draft: Pick<
    z.infer<typeof articleDraftSchema>,
    "contentMarkdown" | "wordCount"
  >,
  finishReason: string | null,
): void {
  const actualWords = countArticleBodyWords(draft.contentMarkdown);
  const expectedWords = draft.wordCount;
  const tooShort =
    actualWords < ARTICLE_TRUNCATION_WORD_FLOOR &&
    actualWords < expectedWords * ARTICLE_TRUNCATION_RATIO_THRESHOLD;
  const hitProviderLengthCap = finishReason === "length";

  if (!tooShort && !hitProviderLengthCap) return;

  const preview = draft.contentMarkdown.slice(0, 160);
  // Structured warn → searchable in Vercel logs as
  // `article_generation_truncation_detected`. Keep keys stable so
  // future ops dashboards / log alerts can filter on them.
  console.warn("article_generation_truncation_detected", {
    finishReason,
    actualWords,
    expectedWords,
    floor: ARTICLE_TRUNCATION_WORD_FLOOR,
    ratioThreshold: ARTICLE_TRUNCATION_RATIO_THRESHOLD,
    reason: hitProviderLengthCap ? "finish_reason_length" : "body_too_short",
    contentMarkdownPreview: preview,
  });

  throw new TruncatedArticleOutputError({
    actualWords,
    expectedWords,
    finishReason,
    contentMarkdownPreview: preview,
  });
}

/**
 * Thrown by {@link generateArticleDraft} when the first attempt
 * AND the schema-repair retry both fail with a schema validation
 * error. Carries both errors so the orchestration layer can stamp
 * a structured failure record onto the job before refunding
 * tokens.
 *
 * Why a dedicated class (instead of just rethrowing the retry
 * error):
 *   * The orchestrator needs to know `retried: true` happened so
 *     it can stamp `retryCount: 1` and `originalErrorMessage` /
 *     `finalErrorMessage` onto `article_jobs.output`.
 *   * `isStructuredArticleGenerationSchemaError` recognizes this
 *     class directly — no need to re-grep the message.
 *   * Future tooling (autopilot run drawer, support dashboard)
 *     can branch on the class to render "Schema retry failed"
 *     copy without parsing the message.
 */
export class SchemaRetryFailedError extends Error {
  readonly kind = "schema_mismatch" as const;
  readonly retried = true as const;
  readonly retryCount: number;
  readonly originalError: unknown;
  readonly retryError: unknown;
  readonly originalErrorMessage: string;
  readonly finalErrorMessage: string;

  constructor(opts: {
    originalError: unknown;
    retryError: unknown;
    retryCount: number;
  }) {
    const originalErrorMessage =
      opts.originalError instanceof Error
        ? opts.originalError.message
        : String(opts.originalError);
    const finalErrorMessage =
      opts.retryError instanceof Error
        ? opts.retryError.message
        : String(opts.retryError);
    super(
      `Article schema retry failed (attempt ${opts.retryCount + 1}). ` +
        `Original: ${originalErrorMessage}. Final: ${finalErrorMessage}.`,
    );
    this.name = "SchemaRetryFailedError";
    this.retryCount = opts.retryCount;
    this.originalError = opts.originalError;
    this.retryError = opts.retryError;
    this.originalErrorMessage = originalErrorMessage;
    this.finalErrorMessage = finalErrorMessage;
  }
}

/**
 * Defensive cap on Claude's output tokens for article generation.
 *
 * Why we set it explicitly (the AI SDK already passes
 * `claude-sonnet-4-6`'s built-in 128k ceiling otherwise):
 *   * Articles in this product target ~1,200–2,500 words ≈ 1,800–
 *     3,800 completion tokens. We've observed a real production
 *     hiccup where Claude returned a structured-output JSON with
 *     a body that stopped mid-sentence after only ~700 completion
 *     tokens — see `assertArticleNotTruncated` below. A snug cap
 *     bounds the worst-case spend on Anthropic when the model
 *     decides to overshoot, AND makes `finishReason === "length"`
 *     a meaningful signal (instead of "we hit 128k", which we
 *     never actually want to hit).
 *   * Update this if the product ships true long-form (>5k words);
 *     keep it as the single source of truth for the article path.
 */
export const ARTICLE_MAX_OUTPUT_TOKENS = 8_000;

/**
 * Minimum actual word count below which we even *consider* an
 * article truncated. Avoids false positives on legitimately short
 * pieces (the schema allows `contentMarkdown.min(100)` chars ≈
 * ~15 words). Articles in this product configure
 * `seo.defaultArticleLength` in the hundreds-to-thousands, so any
 * body shorter than this floor is almost certainly broken.
 */
export const ARTICLE_TRUNCATION_WORD_FLOOR = 300;

/**
 * Ratio (actual / model-reported `wordCount`) below which we treat
 * an article body as truncated, paired with
 * {@link ARTICLE_TRUNCATION_WORD_FLOOR}. Both conditions must hold —
 * a 200-word piece with a self-reported 1000-word target is
 * truncated; a 1400-word piece self-reporting 1500 is fine.
 */
export const ARTICLE_TRUNCATION_RATIO_THRESHOLD = 0.5;

/**
 * Stricter system-prompt suffix appended on the retry attempt.
 * Designed to make Claude's second try collapse to the schema
 * shape — most schema validation failures we've seen come from
 * the model adding extra prose, wrapping the JSON in code fences,
 * or omitting a required field.
 *
 * Exported so tests can assert it lands in the retry's `system`
 * argument (and so a future support tool can show operators
 * exactly what the second attempt asks).
 */
export const STRICT_SCHEMA_REPAIR_INSTRUCTION = [
  "STRICT SCHEMA REPAIR INSTRUCTION (retry attempt):",
  "Your previous response did not match the requested JSON schema.",
  "Return ONLY a valid object matching the requested schema. Do not",
  "include prose, markdown code fences, explanations, or any extra",
  "keys. Every required field must be present and within its",
  "documented length / format constraints.",
].join(" ");

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
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase-hyphenated")
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
  /** From `blogs.niche` when non-empty. */
  blogNiche?: string;
  /** From `blogs.keywords` when non-empty. */
  blogKeywords?: string[];
  /** From `blogs.ai_prompt_template` when non-empty (legacy). */
  legacyAiPromptTemplate?: string;
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
    cachedWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens ?? null,
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
  const {
    blogName,
    blogDescription,
    blogNiche,
    blogKeywords,
    legacyAiPromptTemplate,
    settings,
    brief,
    count,
    existingTitles,
  } = input;
  const { identity, strategy, ai, seo, advanced } = settings;

  const goalsLine = strategy.goals.length
    ? strategy.goals.join(", ")
    : "general thought leadership";

  const articleTypesLine = strategy.preferredArticleTypes.length
    ? strategy.preferredArticleTypes.join(", ")
    : "any of the supported types";

  const customSystemAddendum = advanced.customSystemPrompt.trim()
    ? `\n\nAdditional instructions from the blog owner:\n${advanced.customSystemPrompt.trim()}`
    : "";
  const legacyPromptAddendum = legacyAiPromptAddendum(
    legacyAiPromptTemplate,
    advanced.customSystemPrompt,
  );

  const nicheLine = blogNiche?.trim()
    ? `Blog niche/category: ${blogNiche.trim()}.`
    : "";
  const keywordsText = formatBlogKeywordsList(blogKeywords);
  const keywordsLine = keywordsText
    ? `Primary keywords to consider (use naturally as inspiration — do not stuff every keyword into every idea): ${keywordsText}.`
    : "";

  const positivePromptLine = ai.positivePrompt.trim()
    ? `\n- DO: ${ai.positivePrompt.trim()}`
    : "";
  const negativePromptLine = ai.negativePrompt.trim()
    ? `\n- DO NOT: ${ai.negativePrompt.trim()}`
    : "";

  const approvedTermsLine = settingBullet(
    "Prefer these terms/phrases where naturally relevant",
    ai.approvedTerminology,
  );
  const bannedTermsLine = settingBullet(
    "Avoid these terms/phrases",
    ai.bannedTerminology,
  );
  const articleStructureLine = settingBullet(
    "Typical article shape to aim for when pitching ideas (guidance only)",
    ai.defaultArticleStructure,
  );
  const ctaContextLine = settingBullet(
    "Business / conversion context for ideas",
    ai.preferredCta,
  );
  const headingsHintLine = settingBullet(
    "Heading-structure preference (light guidance for idea angles)",
    seo.defaultHeadingsStructure,
  );
  const faqIdeasLine = seo.faqSection
    ? "\n- Favor topics that could support a concise FAQ section near the end of the article."
    : "";
  const competitorsLine = settingBullet(
    "Do not recommend or positively promote these competitors",
    advanced.competitorsToAvoid,
  );

  const system = [
    `You are a senior content strategist generating fresh article ideas for a blog called "${blogName}".`,
    blogDescription?.trim()
      ? `Blog description: ${blogDescription.trim()}`
      : null,
    nicheLine,
    keywordsLine,
    `Target audience: ${identity.audience || "a general professional audience"}.`,
    `Tone: ${identity.tone || "professional, clear, friendly"}.`,
    `Editorial goals: ${goalsLine}.`,
    `Preferred article formats: ${articleTypesLine}.`,
    positivePromptLine,
    negativePromptLine,
    approvedTermsLine,
    bannedTermsLine,
    articleStructureLine,
    ctaContextLine,
    headingsHintLine,
    faqIdeasLine,
    competitorsLine,
    `Each idea must be specific enough to write a full article from. Avoid vague headlines like "Tips for Success".${customSystemAddendum}${legacyPromptAddendum}`,
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

  const internalLinksIdeasLine = settingBullet(
    "Topics that could naturally link to these internal themes (slug/topic hints only, not URLs)",
    advanced.internalLinksToPrioritize,
  );

  const existingTitlesLine =
    existingTitles && existingTitles.length > 0
      ? `Avoid duplicating any of these existing post titles:\n${existingTitles.map((t) => `- ${t}`).join("\n")}`
      : "";

  const prompt = [
    `Generate exactly ${count} distinct article ideas.`,
    briefLine,
    topicsCoverLine,
    topicsAvoidLine,
    internalLinksIdeasLine,
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
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase-hyphenated")
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
  /**
   * Provider-reported finish reason for the SDK call (`"stop"`,
   * `"length"`, `"content-filter"`, etc.) or `null` when the SDK
   * didn't report one. Persisted on `articles.raw_ai_response` so
   * the truncation guard's decisions stay auditable after the
   * fact — see {@link assertArticleNotTruncated}.
   */
  finishReason: string | null;
  /** Token counts. `null` when the provider did not report them. */
  promptTokens: number | null;
  completionTokens: number | null;
  cachedReadTokens: number | null;
  cachedWriteTokens: number | null;
  /**
   * `true` when the first attempt threw a schema validation error
   * and the second (stricter) attempt succeeded. `false` for the
   * normal one-shot success path. The orchestration stamps this
   * onto `article_jobs.output.retried` so an operator reading a
   * recent job can tell which articles needed repair.
   */
  retried: boolean;
  /**
   * Number of retry attempts that fired. `0` for one-shot success
   * (`retried === false`); `1` when the schema repair retry was
   * needed and succeeded.
   */
  retryCount: number;
};

export interface GenerateArticleDraftInput {
  blogName: string;
  blogDescription?: string;
  blogNiche?: string;
  blogKeywords?: string[];
  legacyAiPromptTemplate?: string;
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
 * Schema-repair retry (single shot):
 *   The Anthropic API occasionally returns a response that doesn't
 *   fit the requested Zod schema (extra prose, code-fenced JSON,
 *   missing required field). When that happens, the SDK throws
 *   `NoObjectGeneratedError`. Rather than refund the user
 *   immediately we run ONE second attempt with the same model + a
 *   stricter system-prompt suffix
 *   ({@link STRICT_SCHEMA_REPAIR_INSTRUCTION}) telling Claude to
 *   return ONLY a schema-conforming object.
 *
 *   * If the retry succeeds → we return the draft with
 *     `retried: true, retryCount: 1` so the orchestrator can stamp
 *     this onto `article_jobs.output` for ops visibility.
 *   * If the retry fails with another schema error → we throw
 *     {@link SchemaRetryFailedError}, which the orchestrator
 *     recognizes via {@link isStructuredArticleGenerationSchemaError}
 *     and uses to stamp structured failure metadata before refunding
 *     tokens.
 *
 *   Synth-token + `usage_events` accounting is unchanged: the
 *   orchestrator's `consumeTeamTokens` is keyed off `jobId` (not
 *   per Claude call) so the retry costs the user nothing extra.
 *   The Anthropic API bill IS doubled for the rare retry, but
 *   that's a Vercel-side operational cost, not a user-visible
 *   billing event.
 *
 * Non-schema errors (auth, rate limit, network) bypass the retry —
 * a stricter prompt won't fix those. They propagate as-is so the
 * orchestration's existing refund + FatalError flow handles them.
 *
 * Throws:
 *   * `SchemaRetryFailedError` — both attempts hit a schema
 *     validation failure. Inner `originalError` and `retryError`
 *     carry the underlying SDK errors.
 *   * `NoObjectGeneratedError` — only when the failure occurred on
 *     a path where retry was disabled (none today; reserved for
 *     future test-only injection).
 *   * Any other SDK error — propagated as-is.
 */
export async function generateArticleDraft(
  input: GenerateArticleDraftInput,
): Promise<GeneratedArticleDraft> {
  const provider = resolveAnthropic(input.anthropicProvider);
  const modelId = input.model ?? getModelForTask("articleGeneration");
  const { system: baseSystem, prompt } = buildArticlePromptParts(input);

  // First attempt: normal prompt.
  let firstError: unknown;
  try {
    const draft = await callArticleSdk({
      provider,
      modelId,
      system: baseSystem,
      prompt,
    });
    return { ...draft, retried: false, retryCount: 0 };
  } catch (err) {
    if (
      !isStructuredArticleGenerationSchemaError(err) &&
      !(err instanceof TruncatedArticleOutputError)
    ) {
      // Non-schema, non-truncation failure (auth / rate limit /
      // network). Bubble as-is — a stricter prompt won't fix it
      // and burning a second Claude call would just delay the
      // refund.
      throw err;
    }
    firstError = err;
  }

  // Second attempt: same model + prompt + stricter repair suffix.
  // The suffix nudges Claude away from schema-mismatch failures;
  // for truncation it doesn't help directly, but a fresh inference
  // call usually clears transient provider-side stops (which is
  // the failure mode we've actually seen in prod).
  const stricterSystem = `${baseSystem}\n\n${STRICT_SCHEMA_REPAIR_INSTRUCTION}`;
  try {
    const draft = await callArticleSdk({
      provider,
      modelId,
      system: stricterSystem,
      prompt,
    });
    return { ...draft, retried: true, retryCount: 1 };
  } catch (retryErr) {
    // Truncation on the retry → distinct error class so the
    // orchestrator stamps `failureKind: "truncated_output"` (not
    // `"schema_mismatch"`). When the first attempt was schema and
    // the retry was truncation (or vice versa), we still surface
    // the most informative class given the FINAL outcome.
    if (retryErr instanceof TruncatedArticleOutputError) {
      const original =
        firstError instanceof TruncatedArticleOutputError
          ? firstError
          : retryErr; // schema-then-truncation: use the truncation as `original` too so the class invariants hold.
      throw new TruncationRetryFailedError({
        originalError: original,
        retryError: retryErr,
        retryCount: 1,
      });
    }
    if (!isStructuredArticleGenerationSchemaError(retryErr)) {
      // The retry failed with a NEW kind of error (e.g. the model
      // recovered from schema but the API rate-limited the second
      // call). Surface it directly — the orchestrator's refund
      // path handles it the same way as a non-schema first-attempt
      // failure. Stamping `retried: true` here would be misleading
      // (we DID retry, but the failure isn't a structured-output
      // issue).
      throw retryErr;
    }
    throw new SchemaRetryFailedError({
      originalError: firstError,
      retryError: retryErr,
      retryCount: 1,
    });
  }
}

/**
 * Inner SDK call shared by the first attempt + the retry. Splits
 * cleanly so the retry path can pass a different `system` without
 * duplicating the `Output.object(...)` boilerplate.
 *
 * Returns the typed schema fields + token counts. Does NOT set
 * `retried` / `retryCount` — those are stamped by the public
 * {@link generateArticleDraft} based on which attempt succeeded.
 */
async function callArticleSdk(args: {
  provider: AnthropicLike;
  modelId: string;
  system: string;
  prompt: string;
}): Promise<Omit<GeneratedArticleDraft, "retried" | "retryCount">> {
  const result = await generateText({
    model: args.provider(args.modelId),
    output: Output.object({
      schema: articleDraftSchema,
      name: "article_draft",
      description: "A single article draft for the configured blog.",
    }),
    system: args.system,
    prompt: args.prompt,
    // Defensive cap — see ARTICLE_MAX_OUTPUT_TOKENS jsdoc. Makes
    // `finishReason === "length"` a meaningful truncation signal
    // (bounded near typical article size, far below model max).
    maxOutputTokens: ARTICLE_MAX_OUTPUT_TOKENS,
  });

  const draft = {
    ...result.output,
    model: args.modelId,
    finishReason: result.finishReason ?? null,
    promptTokens: result.usage.inputTokens ?? null,
    completionTokens: result.usage.outputTokens ?? null,
    cachedReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? null,
    cachedWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens ?? null,
  };

  // Throws TruncatedArticleOutputError when the body looks cut off.
  // The caller (generateArticleDraft) treats this as retriable, the
  // same way it handles schema validation errors.
  assertArticleNotTruncated(draft, draft.finishReason);

  return draft;
}

/**
 * Splits prompt construction out of {@link generateArticleDraft} so
 * tests can assert that the user-facing brief makes it into the prompt
 * without spinning up a fake AI SDK. Exported only for tests; treat as
 * an implementation detail outside this file.
 */
export function buildArticlePromptParts(input: GenerateArticleDraftInput): {
  system: string;
  prompt: string;
} {
  const {
    blogName,
    blogDescription,
    blogNiche,
    blogKeywords,
    legacyAiPromptTemplate,
    settings,
    brief,
  } = input;
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
  const legacyPromptAddendum = legacyAiPromptAddendum(
    legacyAiPromptTemplate,
    advanced.customSystemPrompt,
  );

  const nicheLine = blogNiche?.trim()
    ? `Blog niche/category: ${blogNiche.trim()}.`
    : "";

  const positivePromptLine = ai.positivePrompt.trim()
    ? `\n- DO: ${ai.positivePrompt.trim()}`
    : "";
  const negativePromptLine = ai.negativePrompt.trim()
    ? `\n- DO NOT: ${ai.negativePrompt.trim()}`
    : "";

  const approvedTermsLine = settingBullet(
    "Prefer these terms/phrases where naturally relevant",
    ai.approvedTerminology,
  );
  const bannedTermsLine = settingBullet(
    "Avoid these terms/phrases",
    ai.bannedTerminology,
  );
  const articleStructureLine = settingBullet(
    "Use this article structure as guidance when it does not conflict with the requested article type",
    ai.defaultArticleStructure,
  );
  const affiliateLine = settingBullet(
    "Include this affiliate disclosure near the beginning or before affiliate-style recommendations",
    advanced.affiliateDisclosure,
  );
  const competitorsLine = settingBullet(
    "Do not recommend, link to, or positively promote these competitors",
    advanced.competitorsToAvoid,
  );

  const system = [
    `You are a senior content writer producing a single Markdown article for a blog called "${blogName}".`,
    blogDescription?.trim()
      ? `Blog description: ${blogDescription.trim()}`
      : null,
    nicheLine,
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
    approvedTermsLine,
    bannedTermsLine,
    articleStructureLine,
    affiliateLine,
    competitorsLine,
    internalLinkingGuidance(seo.internalLinkingPreference),
    externalLinkingGuidance(seo.externalLinkingPreference),
    `Your response must conform to the provided JSON schema. Write the article body as Markdown (headings with #, lists with -, links with [text](url)). Do NOT wrap the Markdown in code fences. Do NOT include front-matter.${customSystemAddendum}${legacyPromptAddendum}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const keywordsText = formatBlogKeywordsList(blogKeywords);
  const blogKeywordsLine = keywordsText
    ? `Blog-level SEO keywords (supporting context only): ${keywordsText}. Use them as topical guidance — include relevant keywords naturally where appropriate, but do not force all of them into the article. The idea's target keyword in the brief below is the primary keyword for this article.`
    : "";

  const briefLine = brief?.trim()
    ? `The user provided this topic / brief:\n"""\n${brief.trim()}\n"""\n\nUse it as the primary subject of the article.`
    : `No specific topic was provided. Pick a fresh, on-strategy topic that fits the blog's content goals (${goalsLine}) and target audience. Avoid topics that obviously duplicate existing posts.`;

  const topicsCoverLine = strategy.topicsToCover.trim()
    ? `Topics the blog wants covered: ${strategy.topicsToCover.trim()}.`
    : "";
  const topicsAvoidLine = strategy.topicsToAvoid.trim()
    ? `Topics to avoid: ${strategy.topicsToAvoid.trim()}.`
    : "";

  const headingsStructureLine = settingBullet(
    "Use this heading guidance when planning H2/H3 structure",
    seo.defaultHeadingsStructure,
  );
  const metaDescriptionStyleLine = settingBullet(
    "Shape the metaDescription field according to this preference",
    seo.metaDescriptionStyle,
  );
  const ctaLine = settingBullet(
    "Include this call-to-action naturally near the conclusion when provided",
    ai.preferredCta,
  );
  const disclaimerLine = settingBullet(
    "Add this disclaimer near the end of the article when provided",
    advanced.defaultDisclaimer,
  );
  const internalLinksLine = settingBullet(
    "Mention or reserve space for these internal link themes where natural (topic/slug hints only, not real URLs)",
    advanced.internalLinksToPrioritize,
  );
  const faqLine = seo.faqSection
    ? "Include a concise FAQ section (3-5 Q&A pairs) near the end of the article, before any disclaimer."
    : "";

  const prompt = [
    briefLine,
    blogKeywordsLine,
    topicsCoverLine,
    topicsAvoidLine,
    headingsStructureLine,
    metaDescriptionStyleLine,
    ctaLine,
    disclaimerLine,
    internalLinksLine,
    faqLine,
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
