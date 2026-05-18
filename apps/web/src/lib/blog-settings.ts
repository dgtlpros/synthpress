import type { Json } from "@/lib/supabase/database.types";

/**
 * The "fingerprint" of a blog. Persisted as a single jsonb column on
 * `blogs.settings` so the shape can evolve from app code without a migration
 * per field. The TS type is the source of truth — `loadBlogSettings` always
 * normalizes whatever raw json is in the DB into this canonical shape so
 * downstream UI never has to defend against missing keys.
 *
 * Lives in `lib/` (not `services/`) on purpose: the shape is pure data with
 * no server-only dependencies, and both server actions and client form
 * components import it.
 *
 * Sections mirror the tabs in the settings UI:
 *   identity    → who the blog is
 *   strategy    → what content it should create
 *   ai          → how the AI should write
 *   seo         → SEO defaults applied to every post
 *   automation  → generation cadence + review rules
 *   publishing  → defaults applied when sending to a CMS
 *   media       → image generation / sourcing
 *   advanced    → power-user overrides (custom prompts/templates)
 */

export type BlogContentGoal =
  | "educate"
  | "rank"
  | "affiliate"
  | "leads"
  | "news"
  | "brand";

export type BlogPointOfView =
  | "first_person_singular"
  | "first_person_plural"
  | "second_person"
  | "third_person"
  | "editorial";

export type BlogReadingLevel =
  | "elementary"
  | "intermediate"
  | "advanced"
  | "expert";

export type BlogPublishStatus = "draft" | "scheduled" | "published";

export type BlogImageSource =
  | "ai_generated"
  | "stock_unsplash"
  | "stock_pexels"
  | "manual_upload"
  | "none";

/**
 * Which image provider the autopilot picker uses for newly-generated
 * articles. Distinct from `BlogImageSource` (which is legacy / for
 * the old "where does the bytes come from" axis) — this enum is the
 * id passed to `getImageProvider(...)` in the image-provider
 * registry. Today `'unsplash'` is the only real adapter; `'none'`
 * disables automatic picking entirely (users still pick manually
 * from the editor). New providers slot in by adding a value here +
 * a registry entry — no other call sites change.
 */
export type BlogImageProvider = "unsplash" | "none";

export type BlogAutomationMode = "manual" | "autopilot";

export type BlogContentFreshness =
  | "evergreen"
  | "trending"
  | "news"
  | "tutorial";

export interface BlogIdentitySettings {
  audience: string;
  language: string;
  tone: string;
  readingLevel: BlogReadingLevel;
  pointOfView: BlogPointOfView;
  defaultAuthorPersona: string;
}

export interface BlogStrategySettings {
  goals: BlogContentGoal[];
  monetization: string;
  competitors: string;
  contentFreshness: BlogContentFreshness;
  preferredArticleTypes: string[];
  topicsToCover: string;
  topicsToAvoid: string;
}

export interface BlogAiSettings {
  positivePrompt: string;
  negativePrompt: string;
  approvedTerminology: string;
  bannedTerminology: string;
  exampleArticleStyle: string;
  defaultArticleStructure: string;
  preferredCta: string;
}

export interface BlogSeoSettings {
  strategy: string;
  metaDescriptionStyle: string;
  keywordUsage: "natural" | "balanced" | "aggressive";
  internalLinkingPreference: "none" | "occasional" | "aggressive";
  externalLinkingPreference: "none" | "occasional" | "aggressive";
  slugFormat: "lowercase-hyphenated" | "title-case" | "short-id";
  titleFormat: string;
  defaultArticleLength: number;
  defaultHeadingsStructure: string;
  faqSection: boolean;
  schemaMarkup: boolean;
  featuredImagePreference: "always" | "when_relevant" | "never";
}

export interface BlogAutomationSettings {
  /**
   * Workflow shape: `manual` = the user drives generation; `autopilot` =
   * the future scheduler will pick up this blog. Independent of `enabled`
   * so users can configure autopilot without arming it.
   */
  mode: BlogAutomationMode;
  /**
   * Kill switch for the autopilot scheduler. The scheduler treats a blog
   * as eligible only when `mode === "autopilot" && enabled === true`.
   * Defaults to `false` so a brand new blog never starts spending tokens
   * on its own.
   */
  enabled: boolean;
  generatePerWeek: number;
  requireReview: boolean;
  autoSchedule: boolean;
  preferredDays: string[];
  publishWindowStart: string;
  publishWindowEnd: string;
  timezone: string;
  maxPostsPerDay: number;
  regenerateOnFail: boolean;
  /**
   * Autopilot tops the approved-idea pool back up when the count of
   * approved-but-not-yet-converted ideas drops below this threshold.
   */
  backlogThreshold: number;
  /**
   * Per-blog daily Synth-token cap for autopilot. `null` means no
   * per-blog cap beyond the team's overall balance / plan limit.
   */
  dailyTokenBudget: number | null;
  /**
   * When the autopilot scheduler auto-pauses a blog (e.g. repeated
   * failures), it stamps these three fields onto `settings.automation`
   * alongside `enabled=false`. The settings panel reads them to
   * distinguish "user turned autopilot off" from "the system paused
   * it for a reason".
   *
   *   * `pausedReason` — short machine-readable code (currently the
   *     only value is `"failure_rate"`; future: `"budget_exhausted"`,
   *     `"plan_downgrade"`, etc.)
   *   * `pausedAt` — ISO timestamp the pause was recorded.
   *   * `pausedMessage` — human copy the panel renders verbatim.
   *
   * All three are cleared the moment the user re-enables autopilot
   * via the settings save flow (see `actions/workspace.ts`).
   */
  pausedReason: string | null;
  pausedAt: string | null;
  pausedMessage: string | null;
}

export interface BlogPublishingSettings {
  defaultDestination: "wordpress" | "none";
  defaultStatus: BlogPublishStatus;
  defaultCategory: string;
  defaultTags: string[];
  defaultAuthor: string;
  uploadFeaturedImage: boolean;
  updateExistingPosts: boolean;
  /**
   * When `true` AND all other autopilot gates pass
   * (`automation.mode === 'autopilot'`,
   * `automation.enabled === true`,
   * `automation.requireReview === false`,
   * `triggerSource === 'autopilot'`, WordPress connection is
   * present), the article-generation workflow sends the saved
   * article to WordPress as a draft right after image picking.
   * Default: `false` — safe posture so existing autopilot blogs
   * don't surprise users by publishing on their behalf.
   *
   * Live auto-publish is intentionally NOT exposed; this v1
   * always sends as a draft. WordPress publish failures never
   * fail the article-generation job — they emit a warning in
   * `article_jobs.output.wpPublish` instead.
   */
  autoSendToWordPressDraft: boolean;
}

export interface BlogMediaSettings {
  generateFeaturedImage: boolean;
  imageStylePrompt: string;
  imageSource: BlogImageSource;
  generateAltText: boolean;
  defaultImageDimensions: string;
  includeInlineImages: boolean;
  /**
   * Run the autopilot image picker after every AI-generated article.
   * When `false`, the article lands `ready_for_review` without
   * automatic picks — users can still pick images by hand in the
   * editor. Default: `true`.
   */
  autoPickImages: boolean;
  /**
   * Which provider the autopilot picker queries. `'none'` is
   * functionally identical to `autoPickImages = false` but kept as
   * a separate axis so users can leave auto-pick on while they
   * shop for a different provider. Default: `'unsplash'`.
   */
  imageProvider: BlogImageProvider;
}

export interface BlogAdvancedSettings {
  customSystemPrompt: string;
  customArticleTemplate: string;
  customOutlineTemplate: string;
  defaultDisclaimer: string;
  affiliateDisclosure: string;
  internalLinksToPrioritize: string;
  competitorsToAvoid: string;
}

export interface BlogSettings {
  identity: BlogIdentitySettings;
  strategy: BlogStrategySettings;
  ai: BlogAiSettings;
  seo: BlogSeoSettings;
  automation: BlogAutomationSettings;
  publishing: BlogPublishingSettings;
  media: BlogMediaSettings;
  advanced: BlogAdvancedSettings;
}

export const DEFAULT_BLOG_SETTINGS: BlogSettings = {
  identity: {
    audience: "",
    language: "en",
    tone: "",
    readingLevel: "intermediate",
    pointOfView: "third_person",
    defaultAuthorPersona: "",
  },
  strategy: {
    goals: ["educate"],
    monetization: "",
    competitors: "",
    contentFreshness: "evergreen",
    preferredArticleTypes: ["how_to", "listicle"],
    topicsToCover: "",
    topicsToAvoid: "",
  },
  ai: {
    positivePrompt: "",
    negativePrompt: "",
    approvedTerminology: "",
    bannedTerminology: "",
    exampleArticleStyle: "",
    defaultArticleStructure: "",
    preferredCta: "",
  },
  seo: {
    strategy: "",
    metaDescriptionStyle: "",
    keywordUsage: "balanced",
    internalLinkingPreference: "occasional",
    externalLinkingPreference: "occasional",
    slugFormat: "lowercase-hyphenated",
    titleFormat: "",
    defaultArticleLength: 1200,
    defaultHeadingsStructure: "",
    faqSection: false,
    schemaMarkup: false,
    featuredImagePreference: "when_relevant",
  },
  automation: {
    mode: "manual",
    enabled: false,
    generatePerWeek: 5,
    requireReview: true,
    autoSchedule: false,
    preferredDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    publishWindowStart: "08:00",
    publishWindowEnd: "17:00",
    // UTC by default — the dev's local zone shouldn't leak into every
    // blog created on the platform. The settings UI lets users pick
    // their own zone if they want windowed publishing.
    timezone: "Etc/UTC",
    maxPostsPerDay: 3,
    regenerateOnFail: true,
    backlogThreshold: 10,
    dailyTokenBudget: null,
    pausedReason: null,
    pausedAt: null,
    pausedMessage: null,
  },
  publishing: {
    defaultDestination: "none",
    defaultStatus: "draft",
    defaultCategory: "",
    defaultTags: [],
    defaultAuthor: "",
    uploadFeaturedImage: true,
    updateExistingPosts: false,
    // Off by default: opt-in posture for auto-send so existing
    // autopilot blogs don't ship drafts to WordPress without
    // explicit consent.
    autoSendToWordPressDraft: false,
  },
  media: {
    generateFeaturedImage: false,
    imageStylePrompt: "",
    imageSource: "ai_generated",
    generateAltText: true,
    defaultImageDimensions: "1200x630",
    includeInlineImages: false,
    // Autopilot picker defaults on with Unsplash. Existing blogs
    // (rows without these keys in `settings.media`) inherit the
    // same posture via the normalizer's fallback.
    autoPickImages: true,
    imageProvider: "unsplash",
  },
  advanced: {
    customSystemPrompt: "",
    customArticleTemplate: "",
    customOutlineTemplate: "",
    defaultDisclaimer: "",
    affiliateDisclosure: "",
    internalLinksToPrioritize: "",
    competitorsToAvoid: "",
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickString(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  if (!source) return fallback;
  const v = source[key];
  return typeof v === "string" ? v : fallback;
}

function pickNumber(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  if (!source) return fallback;
  const v = source[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Like {@link pickNumber} but allows `null` as a meaningful value.
 * Used for the autopilot daily-token-budget where `null` ≠ default; it
 * encodes "no per-blog cap, fall back to the team's overall balance".
 */
function pickNumberOrNull(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback: number | null,
): number | null {
  if (!source) return fallback;
  const v = source[key];
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

/**
 * Like {@link pickString} but allows `null` as a meaningful value.
 * Used for the autopilot pause-metadata fields where `null` ≠ default;
 * it encodes "this blog has never been paused".
 */
function pickStringOrNull(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback: string | null,
): string | null {
  if (!source) return fallback;
  const v = source[key];
  if (v === null) return null;
  if (typeof v === "string") return v;
  return fallback;
}

function pickBoolean(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback: boolean,
): boolean {
  if (!source) return fallback;
  const v = source[key];
  return typeof v === "boolean" ? v : fallback;
}

function pickStringArray(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback: string[],
): string[] {
  if (!source) return fallback;
  const v = source[key];
  if (!Array.isArray(v)) return fallback;
  return v.filter((item): item is string => typeof item === "string");
}

function pickEnum<T extends string>(
  source: Record<string, unknown> | undefined,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!source) return fallback;
  const v = source[key];
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

const READING_LEVELS = [
  "elementary",
  "intermediate",
  "advanced",
  "expert",
] as const satisfies readonly BlogReadingLevel[];
const POVS = [
  "first_person_singular",
  "first_person_plural",
  "second_person",
  "third_person",
  "editorial",
] as const satisfies readonly BlogPointOfView[];
const FRESHNESS = [
  "evergreen",
  "trending",
  "news",
  "tutorial",
] as const satisfies readonly BlogContentFreshness[];
const KEYWORD_USAGE = ["natural", "balanced", "aggressive"] as const;
const LINK_PREFS = ["none", "occasional", "aggressive"] as const;
const SLUG_FORMATS = [
  "lowercase-hyphenated",
  "title-case",
  "short-id",
] as const;
const FEATURED_IMG_PREFS = ["always", "when_relevant", "never"] as const;
const PUB_DESTINATIONS = ["wordpress", "none"] as const;
const PUB_STATUSES = [
  "draft",
  "scheduled",
  "published",
] as const satisfies readonly BlogPublishStatus[];
const IMAGE_SOURCES = [
  "ai_generated",
  "stock_unsplash",
  "stock_pexels",
  "manual_upload",
  "none",
] as const satisfies readonly BlogImageSource[];
const IMAGE_PROVIDERS = [
  "unsplash",
  "none",
] as const satisfies readonly BlogImageProvider[];
const AUTOMATION_MODES = [
  "manual",
  "autopilot",
] as const satisfies readonly BlogAutomationMode[];

/**
 * Normalize whatever raw `blogs.settings` jsonb is in the DB into the
 * canonical {@link BlogSettings} shape. Missing keys fall back to
 * {@link DEFAULT_BLOG_SETTINGS}; unrecognized keys are dropped.
 */
export function loadBlogSettings(raw: Json | null | undefined): BlogSettings {
  if (!isObject(raw)) return DEFAULT_BLOG_SETTINGS;
  const d = DEFAULT_BLOG_SETTINGS;

  const identity = isObject(raw.identity) ? raw.identity : undefined;
  const strategy = isObject(raw.strategy) ? raw.strategy : undefined;
  const ai = isObject(raw.ai) ? raw.ai : undefined;
  const seo = isObject(raw.seo) ? raw.seo : undefined;
  const automation = isObject(raw.automation) ? raw.automation : undefined;
  const publishing = isObject(raw.publishing) ? raw.publishing : undefined;
  const media = isObject(raw.media) ? raw.media : undefined;
  const advanced = isObject(raw.advanced) ? raw.advanced : undefined;

  return {
    identity: {
      audience: pickString(identity, "audience", d.identity.audience),
      language: pickString(identity, "language", d.identity.language),
      tone: pickString(identity, "tone", d.identity.tone),
      readingLevel: pickEnum(
        identity,
        "readingLevel",
        READING_LEVELS,
        d.identity.readingLevel,
      ),
      pointOfView: pickEnum(
        identity,
        "pointOfView",
        POVS,
        d.identity.pointOfView,
      ),
      defaultAuthorPersona: pickString(
        identity,
        "defaultAuthorPersona",
        d.identity.defaultAuthorPersona,
      ),
    },
    strategy: {
      goals: pickStringArray(strategy, "goals", d.strategy.goals).filter(
        (g): g is BlogContentGoal =>
          ["educate", "rank", "affiliate", "leads", "news", "brand"].includes(
            g,
          ),
      ),
      monetization: pickString(
        strategy,
        "monetization",
        d.strategy.monetization,
      ),
      competitors: pickString(strategy, "competitors", d.strategy.competitors),
      contentFreshness: pickEnum(
        strategy,
        "contentFreshness",
        FRESHNESS,
        d.strategy.contentFreshness,
      ),
      preferredArticleTypes: pickStringArray(
        strategy,
        "preferredArticleTypes",
        d.strategy.preferredArticleTypes,
      ),
      topicsToCover: pickString(
        strategy,
        "topicsToCover",
        d.strategy.topicsToCover,
      ),
      topicsToAvoid: pickString(
        strategy,
        "topicsToAvoid",
        d.strategy.topicsToAvoid,
      ),
    },
    ai: {
      positivePrompt: pickString(ai, "positivePrompt", d.ai.positivePrompt),
      negativePrompt: pickString(ai, "negativePrompt", d.ai.negativePrompt),
      approvedTerminology: pickString(
        ai,
        "approvedTerminology",
        d.ai.approvedTerminology,
      ),
      bannedTerminology: pickString(
        ai,
        "bannedTerminology",
        d.ai.bannedTerminology,
      ),
      exampleArticleStyle: pickString(
        ai,
        "exampleArticleStyle",
        d.ai.exampleArticleStyle,
      ),
      defaultArticleStructure: pickString(
        ai,
        "defaultArticleStructure",
        d.ai.defaultArticleStructure,
      ),
      preferredCta: pickString(ai, "preferredCta", d.ai.preferredCta),
    },
    seo: {
      strategy: pickString(seo, "strategy", d.seo.strategy),
      metaDescriptionStyle: pickString(
        seo,
        "metaDescriptionStyle",
        d.seo.metaDescriptionStyle,
      ),
      keywordUsage: pickEnum(
        seo,
        "keywordUsage",
        KEYWORD_USAGE,
        d.seo.keywordUsage,
      ),
      internalLinkingPreference: pickEnum(
        seo,
        "internalLinkingPreference",
        LINK_PREFS,
        d.seo.internalLinkingPreference,
      ),
      externalLinkingPreference: pickEnum(
        seo,
        "externalLinkingPreference",
        LINK_PREFS,
        d.seo.externalLinkingPreference,
      ),
      slugFormat: pickEnum(seo, "slugFormat", SLUG_FORMATS, d.seo.slugFormat),
      titleFormat: pickString(seo, "titleFormat", d.seo.titleFormat),
      defaultArticleLength: pickNumber(
        seo,
        "defaultArticleLength",
        d.seo.defaultArticleLength,
      ),
      defaultHeadingsStructure: pickString(
        seo,
        "defaultHeadingsStructure",
        d.seo.defaultHeadingsStructure,
      ),
      faqSection: pickBoolean(seo, "faqSection", d.seo.faqSection),
      schemaMarkup: pickBoolean(seo, "schemaMarkup", d.seo.schemaMarkup),
      featuredImagePreference: pickEnum(
        seo,
        "featuredImagePreference",
        FEATURED_IMG_PREFS,
        d.seo.featuredImagePreference,
      ),
    },
    automation: {
      mode: pickEnum(automation, "mode", AUTOMATION_MODES, d.automation.mode),
      enabled: pickBoolean(automation, "enabled", d.automation.enabled),
      generatePerWeek: pickNumber(
        automation,
        "generatePerWeek",
        d.automation.generatePerWeek,
      ),
      requireReview: pickBoolean(
        automation,
        "requireReview",
        d.automation.requireReview,
      ),
      autoSchedule: pickBoolean(
        automation,
        "autoSchedule",
        d.automation.autoSchedule,
      ),
      preferredDays: pickStringArray(
        automation,
        "preferredDays",
        d.automation.preferredDays,
      ),
      publishWindowStart: pickString(
        automation,
        "publishWindowStart",
        d.automation.publishWindowStart,
      ),
      publishWindowEnd: pickString(
        automation,
        "publishWindowEnd",
        d.automation.publishWindowEnd,
      ),
      timezone: pickString(automation, "timezone", d.automation.timezone),
      maxPostsPerDay: pickNumber(
        automation,
        "maxPostsPerDay",
        d.automation.maxPostsPerDay,
      ),
      regenerateOnFail: pickBoolean(
        automation,
        "regenerateOnFail",
        d.automation.regenerateOnFail,
      ),
      backlogThreshold: pickNumber(
        automation,
        "backlogThreshold",
        d.automation.backlogThreshold,
      ),
      dailyTokenBudget: pickNumberOrNull(
        automation,
        "dailyTokenBudget",
        d.automation.dailyTokenBudget,
      ),
      pausedReason: pickStringOrNull(
        automation,
        "pausedReason",
        d.automation.pausedReason,
      ),
      pausedAt: pickStringOrNull(automation, "pausedAt", d.automation.pausedAt),
      pausedMessage: pickStringOrNull(
        automation,
        "pausedMessage",
        d.automation.pausedMessage,
      ),
    },
    publishing: {
      defaultDestination: pickEnum(
        publishing,
        "defaultDestination",
        PUB_DESTINATIONS,
        d.publishing.defaultDestination,
      ),
      defaultStatus: pickEnum(
        publishing,
        "defaultStatus",
        PUB_STATUSES,
        d.publishing.defaultStatus,
      ),
      defaultCategory: pickString(
        publishing,
        "defaultCategory",
        d.publishing.defaultCategory,
      ),
      defaultTags: pickStringArray(
        publishing,
        "defaultTags",
        d.publishing.defaultTags,
      ),
      defaultAuthor: pickString(
        publishing,
        "defaultAuthor",
        d.publishing.defaultAuthor,
      ),
      uploadFeaturedImage: pickBoolean(
        publishing,
        "uploadFeaturedImage",
        d.publishing.uploadFeaturedImage,
      ),
      updateExistingPosts: pickBoolean(
        publishing,
        "updateExistingPosts",
        d.publishing.updateExistingPosts,
      ),
      autoSendToWordPressDraft: pickBoolean(
        publishing,
        "autoSendToWordPressDraft",
        d.publishing.autoSendToWordPressDraft,
      ),
    },
    media: {
      generateFeaturedImage: pickBoolean(
        media,
        "generateFeaturedImage",
        d.media.generateFeaturedImage,
      ),
      imageStylePrompt: pickString(
        media,
        "imageStylePrompt",
        d.media.imageStylePrompt,
      ),
      imageSource: pickEnum(
        media,
        "imageSource",
        IMAGE_SOURCES,
        d.media.imageSource,
      ),
      generateAltText: pickBoolean(
        media,
        "generateAltText",
        d.media.generateAltText,
      ),
      defaultImageDimensions: pickString(
        media,
        "defaultImageDimensions",
        d.media.defaultImageDimensions,
      ),
      includeInlineImages: pickBoolean(
        media,
        "includeInlineImages",
        d.media.includeInlineImages,
      ),
      autoPickImages: pickBoolean(
        media,
        "autoPickImages",
        d.media.autoPickImages,
      ),
      imageProvider: pickEnum(
        media,
        "imageProvider",
        IMAGE_PROVIDERS,
        d.media.imageProvider,
      ),
    },
    advanced: {
      customSystemPrompt: pickString(
        advanced,
        "customSystemPrompt",
        d.advanced.customSystemPrompt,
      ),
      customArticleTemplate: pickString(
        advanced,
        "customArticleTemplate",
        d.advanced.customArticleTemplate,
      ),
      customOutlineTemplate: pickString(
        advanced,
        "customOutlineTemplate",
        d.advanced.customOutlineTemplate,
      ),
      defaultDisclaimer: pickString(
        advanced,
        "defaultDisclaimer",
        d.advanced.defaultDisclaimer,
      ),
      affiliateDisclosure: pickString(
        advanced,
        "affiliateDisclosure",
        d.advanced.affiliateDisclosure,
      ),
      internalLinksToPrioritize: pickString(
        advanced,
        "internalLinksToPrioritize",
        d.advanced.internalLinksToPrioritize,
      ),
      competitorsToAvoid: pickString(
        advanced,
        "competitorsToAvoid",
        d.advanced.competitorsToAvoid,
      ),
    },
  };
}

/**
 * Allow callers to update one section without serializing the whole
 * object. Returns the new fully-merged settings ready for jsonb storage.
 */
export function mergeBlogSettings(
  current: BlogSettings,
  patch: Partial<{
    [K in keyof BlogSettings]: Partial<BlogSettings[K]>;
  }>,
): BlogSettings {
  return {
    identity: { ...current.identity, ...(patch.identity ?? {}) },
    strategy: { ...current.strategy, ...(patch.strategy ?? {}) },
    ai: { ...current.ai, ...(patch.ai ?? {}) },
    seo: { ...current.seo, ...(patch.seo ?? {}) },
    automation: { ...current.automation, ...(patch.automation ?? {}) },
    publishing: { ...current.publishing, ...(patch.publishing ?? {}) },
    media: { ...current.media, ...(patch.media ?? {}) },
    advanced: { ...current.advanced, ...(patch.advanced ?? {}) },
  };
}

export const PREFERRED_DAY_OPTIONS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export const ARTICLE_TYPE_OPTIONS = [
  { value: "how_to", label: "How-to guides" },
  { value: "listicle", label: "Listicles" },
  { value: "comparison", label: "Comparisons" },
  { value: "review", label: "Reviews" },
  { value: "news", label: "News updates" },
  { value: "opinion", label: "Opinion / editorial" },
  { value: "tutorial", label: "Tutorials" },
  { value: "case_study", label: "Case studies" },
] as const;

export const CONTENT_GOAL_OPTIONS: {
  value: BlogContentGoal;
  label: string;
  description: string;
}[] = [
  {
    value: "educate",
    label: "Educate",
    description: "Build trust by explaining things clearly.",
  },
  {
    value: "rank",
    label: "Rank on Google",
    description: "Win SERPs for target keywords.",
  },
  {
    value: "affiliate",
    label: "Drive affiliate clicks",
    description: "Optimize for product comparison and CTRs.",
  },
  {
    value: "leads",
    label: "Generate leads",
    description: "Capture emails / demos.",
  },
  {
    value: "news",
    label: "News updates",
    description: "Cover breaking topics in your niche.",
  },
  {
    value: "brand",
    label: "Brand awareness",
    description: "Position the brand as a thought leader.",
  },
];
