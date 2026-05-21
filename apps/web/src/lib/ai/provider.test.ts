import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOG_SETTINGS, type BlogSettings } from "@/lib/blog-settings";

// Mock the AI SDK + Anthropic provider BEFORE importing the module under test.
// `vi.hoisted` ensures the mock fns are constructed before the `vi.mock`
// factories run (factories themselves are hoisted to the top of the file),
// so they can be referenced both by the factories and by the tests below.
const {
  generateTextMock,
  outputObjectMock,
  anthropicCallable,
  createAnthropicMock,
} = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  outputObjectMock: vi.fn(({ schema, name, description }) => ({
    __outputKind: "object" as const,
    schema,
    name,
    description,
  })),
  anthropicCallable: vi.fn((modelId: string) => ({
    __anthropicModelId: modelId,
  })),
  createAnthropicMock: vi.fn((options: { apiKey: string }) =>
    Object.assign(
      (modelId: string) => ({ __injected: true, modelId, options }),
      { __isInjectedProvider: true },
    ),
  ),
}));

vi.mock("ai", () => {
  // The error class lives inside the factory because `vi.mock` is
  // hoisted above other top-level declarations, and a `class` outside
  // the factory wouldn't exist yet when the mock is registered.
  class FakeNoObjectGeneratedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "NoObjectGeneratedError";
    }
  }
  return {
    generateText: (...args: unknown[]) => generateTextMock(...args),
    Output: {
      object: (input: unknown) => outputObjectMock(input as never),
    },
    NoObjectGeneratedError: FakeNoObjectGeneratedError,
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: anthropicCallable,
  createAnthropic: createAnthropicMock,
}));

import {
  ARTICLE_MAX_OUTPUT_TOKENS,
  ARTICLE_TRUNCATION_WORD_FLOOR,
  assertArticleNotTruncated,
  buildArticlePromptParts,
  buildIdeasPromptParts,
  countArticleBodyWords,
  createAnthropicProvider,
  generateArticleDraft,
  generateIdeas,
  getArticleGenerationFailureKind,
  IDEA_DEFAULT_COUNT,
  isStructuredArticleGenerationSchemaError,
  isTruncatedArticleOutputError,
  NoObjectGeneratedError,
  resolveAnthropic,
  SchemaRetryFailedError,
  STRICT_SCHEMA_REPAIR_INSTRUCTION,
  TruncatedArticleOutputError,
  TruncationRetryFailedError,
} from "./provider";
import { AI_MODELS } from "./models";

// 320-word stub body — kept above ARTICLE_TRUNCATION_WORD_FLOOR (300)
// so the truncation guard treats this as a healthy draft. Tests that
// exercise the truncation path build their own short-body stub.
const draftStub = {
  title: "How to launch a B2B blog in 30 days",
  slug: "how-to-launch-a-b2b-blog-in-30-days",
  excerpt: "A practical 30-day plan to ship your first ten posts.",
  metaDescription:
    "Step-by-step playbook for launching a B2B blog in 30 days, with weekly milestones.",
  contentMarkdown:
    "# How to launch a B2B blog in 30 days\n\n" +
    "Launching a B2B blog is mostly about discipline. Here is the four-week plan we use with our clients to ship the first ten posts on schedule and at a quality bar that builds reader trust from day one. " +
    "The plan assumes a single dedicated owner, one strategic editor, and a freelance writer or two for surge weeks. Adjust the cadence to your team size, but keep the order of weeks intact because each builds on the work from the previous one.\n\n" +
    "## Week 1: positioning\n\n" +
    "Start by clarifying the audience and the editorial voice. Write a short positioning brief that names the target reader, the three pains they wake up worrying about, and the words they use when they describe those pains to a peer. Pin the brief on the docs wiki and reference it whenever an idea feels off-strategy. Run a one-hour voice workshop with the team to align on tone, reading level, and the kind of language you will never use. Capture the workshop output as five do-and-don't pairs in the brief.\n\n" +
    "## Week 2: research\n\n" +
    "Build the keyword and topic map. Pull a hundred head terms from Search Console or a competitor crawl, cluster them by intent, and pick the ten clusters that map cleanly to your positioning. Identify the top three competitors in each cluster and note what they consistently miss. Save the cluster sheet in the wiki and use it as the source for every brief you write in weeks three and four. Treat the map as a living doc that you revisit every month after launch.\n",
  targetKeyword: "launch a b2b blog",
  // Aligned to actual body word count so the truncation guard never trips
  // on the happy-path stub. Tests that need a divergent number override.
  wordCount: 320,
  outline: [
    { heading: "Week 1: positioning", summary: "Clarify audience + voice." },
    { heading: "Week 2: research", summary: "Build the keyword + topic map." },
  ],
};

function buildSettings(overrides?: Partial<BlogSettings>): BlogSettings {
  return {
    ...DEFAULT_BLOG_SETTINGS,
    ...overrides,
    identity: { ...DEFAULT_BLOG_SETTINGS.identity, ...overrides?.identity },
    strategy: { ...DEFAULT_BLOG_SETTINGS.strategy, ...overrides?.strategy },
    ai: { ...DEFAULT_BLOG_SETTINGS.ai, ...overrides?.ai },
    seo: { ...DEFAULT_BLOG_SETTINGS.seo, ...overrides?.seo },
    automation: {
      ...DEFAULT_BLOG_SETTINGS.automation,
      ...overrides?.automation,
    },
    publishing: {
      ...DEFAULT_BLOG_SETTINGS.publishing,
      ...overrides?.publishing,
    },
    media: { ...DEFAULT_BLOG_SETTINGS.media, ...overrides?.media },
    advanced: { ...DEFAULT_BLOG_SETTINGS.advanced, ...overrides?.advanced },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  generateTextMock.mockResolvedValue({
    output: draftStub,
    usage: {
      inputTokens: 1500,
      outputTokens: 850,
      inputTokenDetails: {
        noCacheTokens: 1000,
        cacheReadTokens: 500,
        cacheWriteTokens: 0,
      },
      outputTokenDetails: {},
    },
  });
});

describe("buildArticlePromptParts", () => {
  it("incorporates the blog identity, tone, and reading level into the system prompt", () => {
    const settings = buildSettings({
      identity: {
        ...DEFAULT_BLOG_SETTINGS.identity,
        audience: "indie hackers",
        tone: "snappy, opinionated, no fluff",
        readingLevel: "advanced",
        pointOfView: "first_person_singular",
        language: "en",
        defaultAuthorPersona: "",
      },
    });

    const { system } = buildArticlePromptParts({
      blogName: "Indie Insights",
      settings,
    });

    expect(system).toContain('"Indie Insights"');
    expect(system).toContain("indie hackers");
    expect(system).toContain("snappy, opinionated, no fluff");
    expect(system).toContain("advanced");
    expect(system).toContain("first person singular");
  });

  it("inlines content goals and preferred article types from the strategy", () => {
    const settings = buildSettings({
      strategy: {
        ...DEFAULT_BLOG_SETTINGS.strategy,
        goals: ["rank", "affiliate"],
        preferredArticleTypes: ["how_to", "comparison"],
        topicsToCover: "ai content tools, programmatic SEO",
        topicsToAvoid: "crypto, gambling",
      },
    });

    const { system, prompt } = buildArticlePromptParts({
      blogName: "GrowthLab",
      settings,
    });

    expect(system).toContain("rank, affiliate");
    expect(system).toContain("how_to, comparison");
    expect(prompt).toContain("Topics the blog wants covered");
    expect(prompt).toContain("ai content tools, programmatic SEO");
    expect(prompt).toContain("Topics to avoid");
    expect(prompt).toContain("crypto, gambling");
  });

  it("falls back to a generic content goal when the blog hasn't picked any", () => {
    const settings = buildSettings({
      strategy: {
        ...DEFAULT_BLOG_SETTINGS.strategy,
        goals: [],
        preferredArticleTypes: [],
      },
    });

    const { system, prompt } = buildArticlePromptParts({
      blogName: "Empty Goals",
      settings,
    });

    expect(system).toContain("general thought leadership");
    expect(system).toContain("no specific format preference");
    expect(prompt).toContain("general thought leadership");
  });

  it("uses the brief as the article subject when provided", () => {
    const { prompt } = buildArticlePromptParts({
      blogName: "Acme",
      settings: buildSettings(),
      brief: "  How to onboard new SaaS customers in week one  ",
    });

    expect(prompt).toContain("user provided this topic / brief");
    expect(prompt).toContain("How to onboard new SaaS customers in week one");
    expect(prompt).not.toContain("  How to onboard");
  });

  it("falls back to picking a topic when no brief is provided", () => {
    const { prompt } = buildArticlePromptParts({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(prompt).toContain("No specific topic was provided");
    expect(prompt).not.toContain("user provided this topic");
  });

  it("treats whitespace-only briefs as no brief", () => {
    const { prompt } = buildArticlePromptParts({
      blogName: "Acme",
      settings: buildSettings(),
      brief: "   \n   ",
    });

    expect(prompt).toContain("No specific topic was provided");
  });

  it("includes positive/negative AI guardrails when the blog defines them", () => {
    const settings = buildSettings({
      ai: {
        ...DEFAULT_BLOG_SETTINGS.ai,
        positivePrompt: "Cite original sources where possible.",
        negativePrompt: "Avoid 'in conclusion' phrases.",
      },
    });

    const { system } = buildArticlePromptParts({
      blogName: "Acme",
      settings,
    });

    expect(system).toContain("DO: Cite original sources where possible.");
    expect(system).toContain("DO NOT: Avoid 'in conclusion' phrases.");
  });

  it("appends the blog owner's custom system prompt when set", () => {
    const settings = buildSettings({
      advanced: {
        ...DEFAULT_BLOG_SETTINGS.advanced,
        customSystemPrompt:
          "Always sign off with the team's slogan: 'Ship fast.'",
      },
    });

    const { system } = buildArticlePromptParts({
      blogName: "Acme",
      settings,
    });

    expect(system).toContain("Additional instructions from the blog owner");
    expect(system).toContain("Ship fast.");
  });

  it("includes the blog description in the system prompt when present", () => {
    const { system } = buildArticlePromptParts({
      blogName: "Acme",
      blogDescription: "A blog about durable workflows on Vercel.",
      settings: buildSettings(),
    });

    expect(system).toContain("A blog about durable workflows on Vercel.");
  });

  it("omits empty optional sections from the prompt", () => {
    const { system, prompt } = buildArticlePromptParts({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(system).not.toContain("DO:");
    expect(system).not.toContain("DO NOT:");
    expect(system).not.toContain("Additional instructions from the blog owner");
    expect(system).not.toContain("Prefer these terms/phrases");
    expect(system).not.toContain("Avoid these terms/phrases");
    expect(prompt).not.toContain("Topics the blog wants covered");
    expect(prompt).not.toContain("Topics to avoid");
    expect(prompt).not.toContain("FAQ section");
    expect(prompt).not.toContain("call-to-action");
    expect(prompt).not.toContain("disclaimer");
  });

  it("includes approved and banned terminology when set", () => {
    const settings = buildSettings({
      ai: {
        ...DEFAULT_BLOG_SETTINGS.ai,
        approvedTerminology: "ship fast, learn in public",
        bannedTerminology: "synergy, leverage",
      },
    });
    const { system } = buildArticlePromptParts({
      blogName: "Acme",
      settings,
    });
    expect(system).toContain("Prefer these terms/phrases");
    expect(system).toContain("ship fast, learn in public");
    expect(system).toContain("Avoid these terms/phrases");
    expect(system).toContain("synergy, leverage");
  });

  it("includes article structure, CTA, headings, and meta description style when set", () => {
    const settings = buildSettings({
      ai: {
        ...DEFAULT_BLOG_SETTINGS.ai,
        defaultArticleStructure: "Hook → problem → steps → FAQ → CTA",
        preferredCta: "Start your free trial",
      },
      seo: {
        ...DEFAULT_BLOG_SETTINGS.seo,
        defaultHeadingsStructure: "H2 per major step; H3 for substeps only",
        metaDescriptionStyle:
          "Action-oriented, under 155 chars, include keyword",
      },
    });
    const { system, prompt } = buildArticlePromptParts({
      blogName: "Acme",
      settings,
    });
    expect(system).toContain("Hook → problem → steps → FAQ → CTA");
    expect(prompt).toContain("H2 per major step");
    expect(prompt).toContain("Action-oriented, under 155 chars");
    expect(prompt).toContain("Start your free trial");
  });

  it("adds FAQ instruction when faqSection is true and omits it when false", () => {
    const withFaq = buildSettings({
      seo: { ...DEFAULT_BLOG_SETTINGS.seo, faqSection: true },
    });
    const withoutFaq = buildSettings({
      seo: { ...DEFAULT_BLOG_SETTINGS.seo, faqSection: false },
    });
    const { prompt: promptOn } = buildArticlePromptParts({
      blogName: "Acme",
      settings: withFaq,
    });
    const { prompt: promptOff } = buildArticlePromptParts({
      blogName: "Acme",
      settings: withoutFaq,
    });
    expect(promptOn).toContain("concise FAQ section");
    expect(promptOff).not.toContain("concise FAQ section");
  });

  it("includes disclaimer, affiliate disclosure, and competitors to avoid when set", () => {
    const settings = buildSettings({
      advanced: {
        ...DEFAULT_BLOG_SETTINGS.advanced,
        defaultDisclaimer: "Not financial advice.",
        affiliateDisclosure: "We earn commissions from links.",
        competitorsToAvoid: "CompetitorX, RivalCo",
      },
    });
    const { system, prompt } = buildArticlePromptParts({
      blogName: "Acme",
      settings,
    });
    expect(prompt).toContain("Not financial advice.");
    expect(system).toContain("We earn commissions from links.");
    expect(system).toContain("CompetitorX, RivalCo");
  });

  it("includes aggressive internal-linking guidance when preference is aggressive", () => {
    const settings = buildSettings({
      seo: {
        ...DEFAULT_BLOG_SETTINGS.seo,
        internalLinkingPreference: "aggressive",
        externalLinkingPreference: "none",
      },
    });
    const { system } = buildArticlePromptParts({
      blogName: "Acme",
      settings,
    });
    expect(system).toContain("Include several Markdown internal-link");
  });

  it("includes internal-linking guidance when preference is not none", () => {
    const settings = buildSettings({
      seo: {
        ...DEFAULT_BLOG_SETTINGS.seo,
        internalLinkingPreference: "occasional",
        externalLinkingPreference: "none",
      },
      advanced: {
        ...DEFAULT_BLOG_SETTINGS.advanced,
        internalLinksToPrioritize: "pricing, onboarding checklist",
      },
    });
    const { system, prompt } = buildArticlePromptParts({
      blogName: "Acme",
      settings,
    });
    expect(system).toContain("Internal links:");
    expect(system).toContain("placeholder");
    expect(prompt).toContain("pricing, onboarding checklist");
    expect(system).not.toContain("External references:");
  });

  it("includes external-linking guidance when preference is not none", () => {
    const settings = buildSettings({
      seo: {
        ...DEFAULT_BLOG_SETTINGS.seo,
        externalLinkingPreference: "aggressive",
        internalLinkingPreference: "none",
      },
    });
    const { system } = buildArticlePromptParts({
      blogName: "Acme",
      settings,
    });
    expect(system).toContain("External references:");
    expect(system).not.toContain("Internal links:");
  });

  it("includes blog niche in the system prompt when set", () => {
    const { system } = buildArticlePromptParts({
      blogName: "Acme",
      blogNiche: "Indie SaaS",
      settings: buildSettings(),
    });
    expect(system).toContain("Blog niche/category: Indie SaaS.");
  });

  it("includes blog keywords in the user prompt with natural-use guidance", () => {
    const { prompt } = buildArticlePromptParts({
      blogName: "Acme",
      blogKeywords: ["micro-saas", " bootstrapping "],
      settings: buildSettings(),
      brief: "Target keyword: launch checklist",
    });
    expect(prompt).toContain("Blog-level SEO keywords");
    expect(prompt).toContain("micro-saas, bootstrapping");
    expect(prompt).toContain("do not force all of them");
    expect(prompt).toContain("primary keyword for this article");
    expect(prompt).toContain("launch checklist");
  });

  it("omits niche and blog-keyword lines when unset", () => {
    const { system, prompt } = buildArticlePromptParts({
      blogName: "Acme",
      settings: buildSettings(),
    });
    expect(system).not.toContain("Blog niche/category:");
    expect(prompt).not.toContain("Blog-level SEO keywords");
  });

  it("omits blog-keyword line when all keywords are blank after trim", () => {
    const { prompt } = buildArticlePromptParts({
      blogName: "Acme",
      blogKeywords: ["  ", "\t"],
      settings: buildSettings(),
    });
    expect(prompt).not.toContain("Blog-level SEO keywords");
  });

  it("appends legacy template without lower-priority note when custom system prompt is empty", () => {
    const { system } = buildArticlePromptParts({
      blogName: "Acme",
      legacyAiPromptTemplate: "Keep titles punchy.",
      settings: buildSettings(),
    });
    expect(system).toContain("Legacy blog-level prompt guidance:");
    expect(system).toContain("Keep titles punchy.");
    expect(system).not.toContain("lower priority than Advanced");
  });

  it("appends legacy ai_prompt_template after custom system prompt with lower-priority note", () => {
    const settings = buildSettings({
      advanced: {
        ...DEFAULT_BLOG_SETTINGS.advanced,
        customSystemPrompt: "Use British spelling.",
      },
    });
    const { system } = buildArticlePromptParts({
      blogName: "Acme",
      legacyAiPromptTemplate: "Always mention our newsletter.",
      settings,
    });
    expect(system).toContain("Additional instructions from the blog owner");
    expect(system).toContain("British spelling");
    expect(system).toContain("Legacy blog-level prompt guidance");
    expect(system).toContain("lower priority than Advanced");
    expect(system).toContain("Always mention our newsletter.");
    const legacyIdx = system.indexOf("Legacy blog-level prompt guidance");
    const customIdx = system.indexOf(
      "Additional instructions from the blog owner",
    );
    expect(customIdx).toBeLessThan(legacyIdx);
  });
});

describe("resolveAnthropic / createAnthropicProvider", () => {
  it("falls back to the SDK's default provider when none is injected", () => {
    expect(resolveAnthropic()).toBe(anthropicCallable);
  });

  it("returns the injected provider as-is", () => {
    const injected = vi.fn() as never;
    expect(resolveAnthropic(injected)).toBe(injected);
  });

  it("wires the provided API key into createAnthropic", () => {
    const provider = createAnthropicProvider("test-api-key");
    expect(createAnthropicMock).toHaveBeenCalledWith({
      apiKey: "test-api-key",
    });
    // The mock returns a callable provider object.
    expect(typeof provider).toBe("function");
  });
});

describe("generateArticleDraft", () => {
  it("calls generateText with the configured article-generation model when none is provided", async () => {
    await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(anthropicCallable).toHaveBeenCalledWith(AI_MODELS.articleGeneration);
    expect(generateTextMock).toHaveBeenCalledOnce();
    const callArg = generateTextMock.mock.calls[0]![0]!;
    expect(callArg.model).toEqual({
      __anthropicModelId: AI_MODELS.articleGeneration,
    });
  });

  it("threads a custom model id through to the provider", async () => {
    await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
      model: "claude-haiku-4-5",
    });

    expect(anthropicCallable).toHaveBeenCalledWith("claude-haiku-4-5");
  });

  it("uses an injected anthropic provider when supplied", async () => {
    const injected = vi.fn(
      (modelId: string) => ({ __injected: modelId }) as never,
    );

    await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
      anthropicProvider: injected as never,
    });

    expect(injected).toHaveBeenCalledWith(AI_MODELS.articleGeneration);
    expect(anthropicCallable).not.toHaveBeenCalled();
  });

  it("attaches the structured output schema with a stable name", async () => {
    await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(outputObjectMock).toHaveBeenCalledOnce();
    const arg = outputObjectMock.mock.calls[0]![0] as {
      name: string;
      description: string;
    };
    expect(arg.name).toBe("article_draft");
    expect(arg.description).toMatch(/article draft/i);
  });

  it("passes the system + user prompt built from blog settings", async () => {
    await generateArticleDraft({
      blogName: "Acme",
      blogDescription: "A workflow blog",
      settings: buildSettings({
        identity: {
          ...DEFAULT_BLOG_SETTINGS.identity,
          audience: "platform engineers",
        },
      }),
      brief: "Why durable execution matters for AI",
    });

    const callArg = generateTextMock.mock.calls[0]![0] as {
      system: string;
      prompt: string;
    };
    expect(callArg.system).toContain("Acme");
    expect(callArg.system).toContain("platform engineers");
    expect(callArg.prompt).toContain("Why durable execution matters for AI");
  });

  it("returns the parsed draft together with the model id, token usage, and retried=false on first-try success", async () => {
    const result = await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(result).toEqual({
      ...draftStub,
      model: AI_MODELS.articleGeneration,
      finishReason: null,
      promptTokens: 1500,
      completionTokens: 850,
      cachedReadTokens: 500,
      cachedWriteTokens: 0,
      retried: false,
      retryCount: 0,
    });
    // One Claude call on the happy path — the retry only fires
    // when the first attempt throws a schema error.
    expect(generateTextMock).toHaveBeenCalledOnce();
  });

  it("normalizes missing token counts to null", async () => {
    generateTextMock.mockResolvedValueOnce({
      output: draftStub,
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {},
      },
    });

    const result = await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(result.promptTokens).toBeNull();
    expect(result.completionTokens).toBeNull();
    expect(result.cachedReadTokens).toBeNull();
    expect(result.cachedWriteTokens).toBeNull();
  });

  it("propagates non-schema SDK errors as-is (auth/rate-limit/network bypass the retry path)", async () => {
    // A non-schema failure must NOT trigger the schema-repair
    // retry — a stricter prompt won't fix an auth or rate-limit
    // error, and burning a second Claude call would just delay
    // the orchestration's refund. The error bubbles unchanged.
    generateTextMock.mockRejectedValueOnce(new Error("rate_limit_exceeded"));

    await expect(
      generateArticleDraft({
        blogName: "Acme",
        settings: buildSettings(),
      }),
    ).rejects.toThrow(/rate_limit_exceeded/);
    // ONE call — no retry.
    expect(generateTextMock).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Schema-repair retry — Part B / regression for the autopilot QA bug
// ============================================================================

/**
 * Helper to construct a fake `NoObjectGeneratedError` instance.
 * The runtime mock above defined `FakeNoObjectGeneratedError` as
 * the class behind the SDK export — this helper is the cleanest
 * way to produce one from inside a test without re-importing the
 * mock factory.
 */
function makeNoObjectGeneratedError(message: string): Error {
  const Cls = NoObjectGeneratedError as unknown as new (m: string) => Error;
  return new Cls(message);
}

describe("generateArticleDraft — schema-repair retry", () => {
  it("retries once with the stricter schema-repair instruction when the first attempt throws NoObjectGeneratedError", async () => {
    // First attempt → schema error.
    generateTextMock.mockRejectedValueOnce(
      makeNoObjectGeneratedError(
        "No object generated: response did not match schema",
      ),
    );
    // Second attempt → success (default mock).

    const result = await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(result.retried).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(generateTextMock).toHaveBeenCalledTimes(2);

    // The second call carries the stricter repair suffix in `system`.
    const secondCall = generateTextMock.mock.calls[1]![0] as {
      system: string;
      prompt: string;
    };
    expect(secondCall.system).toContain(STRICT_SCHEMA_REPAIR_INSTRUCTION);
    // First call must NOT carry the repair suffix.
    const firstCall = generateTextMock.mock.calls[0]![0] as {
      system: string;
    };
    expect(firstCall.system).not.toContain(STRICT_SCHEMA_REPAIR_INSTRUCTION);
  });

  it("returns the retried draft as a normal GeneratedArticleDraft (with retried=true)", async () => {
    generateTextMock.mockRejectedValueOnce(
      makeNoObjectGeneratedError("response did not match schema"),
    );

    const result = await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(result).toEqual({
      ...draftStub,
      model: AI_MODELS.articleGeneration,
      finishReason: null,
      promptTokens: 1500,
      completionTokens: 850,
      cachedReadTokens: 500,
      cachedWriteTokens: 0,
      retried: true,
      retryCount: 1,
    });
  });

  it("throws SchemaRetryFailedError when BOTH attempts fail with a schema error (carries both inner errors)", async () => {
    const firstErr = makeNoObjectGeneratedError(
      "No object generated: response did not match schema",
    );
    const secondErr = makeNoObjectGeneratedError(
      "schema validation failed on field `slug`",
    );
    generateTextMock
      .mockRejectedValueOnce(firstErr)
      .mockRejectedValueOnce(secondErr);

    let caught: SchemaRetryFailedError | undefined;
    try {
      await generateArticleDraft({
        blogName: "Acme",
        settings: buildSettings(),
      });
    } catch (err) {
      caught = err as SchemaRetryFailedError;
    }

    expect(caught).toBeInstanceOf(SchemaRetryFailedError);
    expect(caught?.kind).toBe("schema_mismatch");
    expect(caught?.retried).toBe(true);
    expect(caught?.retryCount).toBe(1);
    expect(caught?.originalError).toBe(firstErr);
    expect(caught?.retryError).toBe(secondErr);
    expect(caught?.originalErrorMessage).toContain("No object generated");
    expect(caught?.finalErrorMessage).toContain("schema validation failed");
    // We made exactly two SDK calls.
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry when the FIRST error is non-schema (auth / rate limit / network)", async () => {
    generateTextMock.mockRejectedValueOnce(
      new Error("ECONNRESET: socket hang up"),
    );

    await expect(
      generateArticleDraft({
        blogName: "Acme",
        settings: buildSettings(),
      }),
    ).rejects.toThrow(/ECONNRESET/);
    // No retry — the second mock isn't consumed.
    expect(generateTextMock).toHaveBeenCalledOnce();
  });

  it("rethrows the retry's NEW error verbatim when the retry hits a non-schema failure (no SchemaRetryFailedError wrap)", async () => {
    // First attempt: schema error → triggers the retry path.
    generateTextMock.mockRejectedValueOnce(
      makeNoObjectGeneratedError("No object generated"),
    );
    // Second attempt: provider rate-limits the retry → not a
    // schema issue. We bubble the rate-limit error as-is so the
    // orchestration's refund path treats it like any other
    // non-schema failure.
    generateTextMock.mockRejectedValueOnce(
      new Error("rate_limit_exceeded on retry"),
    );

    await expect(
      generateArticleDraft({
        blogName: "Acme",
        settings: buildSettings(),
      }),
    ).rejects.toThrow(/rate_limit_exceeded on retry/);
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it("recognizes a string-message schema error (forward-compat for SDK upgrades that re-throw under a different class)", async () => {
    // Plain Error instance with a message that matches the
    // schema-error regex set. The SDK upgrade scenario:
    // a future `ai` package wraps NoObjectGeneratedError under
    // a generic AIError but keeps the message contract.
    generateTextMock.mockRejectedValueOnce(
      new Error("response did not match the schema"),
    );

    const result = await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
    });
    expect(result.retried).toBe(true);
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });
});

describe("SchemaRetryFailedError constructor", () => {
  it("stringifies non-Error original / retry inputs (defensive — covers the String() fallbacks)", () => {
    // Real callers always pass an Error instance, but a future
    // refactor could feed in a raw value (e.g. a JSON-parse
    // throw that landed as a string). The constructor must
    // still produce readable messages.
    const err = new SchemaRetryFailedError({
      originalError: "first-as-string",
      retryError: { not: "an-error" },
      retryCount: 1,
    });
    expect(err.originalErrorMessage).toBe("first-as-string");
    // Object → "[object Object]" via String() coercion. Not
    // pretty, but stable and readable in logs.
    expect(err.finalErrorMessage).toBe("[object Object]");
    expect(err.message).toContain("first-as-string");
    expect(err.message).toContain("[object Object]");
  });
});

describe("isStructuredArticleGenerationSchemaError", () => {
  it("recognizes a NoObjectGeneratedError instance", () => {
    expect(
      isStructuredArticleGenerationSchemaError(
        makeNoObjectGeneratedError("No object generated"),
      ),
    ).toBe(true);
  });

  it("recognizes a SchemaRetryFailedError instance", () => {
    const err = new SchemaRetryFailedError({
      originalError: new Error("first"),
      retryError: new Error("second"),
      retryCount: 1,
    });
    expect(isStructuredArticleGenerationSchemaError(err)).toBe(true);
  });

  it.each([
    "No object generated: response did not match schema.",
    "Response did not match the schema",
    "Schema validation failed on field `slug`",
    "schema validation failure",
    "Invalid structured output from model",
  ])("recognizes plain-Error message %j", (message) => {
    expect(isStructuredArticleGenerationSchemaError(new Error(message))).toBe(
      true,
    );
  });

  it.each([
    "auth_failed: invalid API key",
    "rate_limit_exceeded",
    "ECONNRESET: socket hang up",
    "Anthropic API timed out after 30s",
    "Internal server error (500)",
    "model_not_found",
    "Schema is missing", // close but not the canonical phrase
  ])("does NOT match unrelated error message %j", (message) => {
    expect(isStructuredArticleGenerationSchemaError(new Error(message))).toBe(
      false,
    );
  });

  it("returns false for non-Error values", () => {
    expect(isStructuredArticleGenerationSchemaError(undefined)).toBe(false);
    expect(isStructuredArticleGenerationSchemaError(null)).toBe(false);
    expect(isStructuredArticleGenerationSchemaError("schema mismatch")).toBe(
      false,
    );
    expect(isStructuredArticleGenerationSchemaError(42)).toBe(false);
    expect(isStructuredArticleGenerationSchemaError({})).toBe(false);
  });

  it("returns false for truncation errors (kept orthogonal so failureKind doesn't leak)", () => {
    const truncation = new TruncatedArticleOutputError({
      actualWords: 42,
      expectedWords: 2000,
      finishReason: "length",
      contentMarkdownPreview: "…",
    });
    expect(isStructuredArticleGenerationSchemaError(truncation)).toBe(false);
    const retry = new TruncationRetryFailedError({
      originalError: truncation,
      retryError: truncation,
      retryCount: 1,
    });
    expect(isStructuredArticleGenerationSchemaError(retry)).toBe(false);
  });
});

// ============================================================================
// Truncation guard — prod regression: Claude returned a structured-output
// JSON whose `contentMarkdown` was cut off mid-sentence after only ~700
// completion tokens. The guard catches that before the article is saved
// with an incomplete body.
// ============================================================================

describe("countArticleBodyWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countArticleBodyWords("one two three four")).toBe(4);
  });

  it("collapses repeated whitespace and newlines", () => {
    // `#` is counted as a token by the simple whitespace split — that's
    // fine, the truncation guard compares against the model's own word
    // claim (a rough number too) so token-level precision doesn't matter.
    expect(countArticleBodyWords("# heading\n\nline one  two\tthree")).toBe(6);
  });

  it("returns 0 for an empty / whitespace-only body", () => {
    expect(countArticleBodyWords("")).toBe(0);
    expect(countArticleBodyWords("   \n\t")).toBe(0);
  });
});

describe("assertArticleNotTruncated", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  function bodyOfWords(count: number): string {
    return Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
  }

  it("passes when actual word count comfortably matches the model claim", () => {
    expect(() =>
      assertArticleNotTruncated(
        { contentMarkdown: bodyOfWords(1500), wordCount: 1500 },
        "stop",
      ),
    ).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("passes when actual word count is above the floor even if model claim is much higher", () => {
    // 400 actual words, 2000 claimed → ratio 0.2, but above the floor →
    // not truncated. We only flag pieces that are objectively short.
    expect(() =>
      assertArticleNotTruncated(
        { contentMarkdown: bodyOfWords(400), wordCount: 2000 },
        "stop",
      ),
    ).not.toThrow();
  });

  it("passes when body is short but ratio is healthy (legitimate short article)", () => {
    // 80 actual, 100 claimed → ratio 0.8 → not truncated.
    expect(() =>
      assertArticleNotTruncated(
        { contentMarkdown: bodyOfWords(80), wordCount: 100 },
        "stop",
      ),
    ).not.toThrow();
  });

  it("throws when finishReason === 'length' regardless of word count", () => {
    expect(() =>
      assertArticleNotTruncated(
        { contentMarkdown: bodyOfWords(1500), wordCount: 1500 },
        "length",
      ),
    ).toThrow(TruncatedArticleOutputError);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toBe(
      "article_generation_truncation_detected",
    );
    expect(warnSpy.mock.calls[0]![1]).toMatchObject({
      finishReason: "length",
      reason: "finish_reason_length",
    });
  });

  it("throws when body is below the floor AND below half the claimed word count (the prod regression shape)", () => {
    // 140 actual words, 2180 claimed — the exact f22abd10 truncation.
    let caught: unknown;
    try {
      assertArticleNotTruncated(
        { contentMarkdown: bodyOfWords(140), wordCount: 2180 },
        "stop",
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TruncatedArticleOutputError);
    const err = caught as TruncatedArticleOutputError;
    expect(err.kind).toBe("truncated_output");
    expect(err.actualWords).toBe(140);
    expect(err.expectedWords).toBe(2180);
    expect(err.finishReason).toBe("stop");
    expect(err.contentMarkdownPreview).toContain("word0");
    expect(warnSpy.mock.calls[0]![1]).toMatchObject({
      reason: "body_too_short",
      actualWords: 140,
      expectedWords: 2180,
    });
  });

  it("carries a null finishReason through when the SDK didn't report one", () => {
    try {
      assertArticleNotTruncated(
        { contentMarkdown: bodyOfWords(50), wordCount: 1500 },
        null,
      );
    } catch (err) {
      expect((err as TruncatedArticleOutputError).finishReason).toBeNull();
      expect((err as Error).message).toContain("finishReason=unknown");
    }
  });

  it("caps the contentMarkdownPreview at 160 chars for log readability", () => {
    const longBody = "x".repeat(500);
    try {
      assertArticleNotTruncated(
        { contentMarkdown: longBody, wordCount: 5000 },
        "length",
      );
    } catch (err) {
      expect(
        (err as TruncatedArticleOutputError).contentMarkdownPreview.length,
      ).toBe(160);
    }
  });
});

describe("isTruncatedArticleOutputError", () => {
  it("recognizes both TruncatedArticleOutputError and TruncationRetryFailedError", () => {
    const truncation = new TruncatedArticleOutputError({
      actualWords: 10,
      expectedWords: 1500,
      finishReason: "length",
      contentMarkdownPreview: "x",
    });
    expect(isTruncatedArticleOutputError(truncation)).toBe(true);
    const retry = new TruncationRetryFailedError({
      originalError: truncation,
      retryError: truncation,
      retryCount: 1,
    });
    expect(isTruncatedArticleOutputError(retry)).toBe(true);
  });

  it("does NOT match schema errors, plain errors, or non-Error values", () => {
    expect(isTruncatedArticleOutputError(new Error("rate_limit"))).toBe(false);
    expect(
      isTruncatedArticleOutputError(makeNoObjectGeneratedError("bad")),
    ).toBe(false);
    expect(
      isTruncatedArticleOutputError(
        new SchemaRetryFailedError({
          originalError: new Error("a"),
          retryError: new Error("b"),
          retryCount: 1,
        }),
      ),
    ).toBe(false);
    expect(isTruncatedArticleOutputError(undefined)).toBe(false);
    expect(isTruncatedArticleOutputError("anything")).toBe(false);
  });
});

describe("getArticleGenerationFailureKind", () => {
  it("returns 'truncated_output' for truncation errors", () => {
    const err = new TruncatedArticleOutputError({
      actualWords: 5,
      expectedWords: 1500,
      finishReason: "length",
      contentMarkdownPreview: "x",
    });
    expect(getArticleGenerationFailureKind(err)).toBe("truncated_output");
  });

  it("returns 'schema_mismatch' for schema errors", () => {
    expect(
      getArticleGenerationFailureKind(makeNoObjectGeneratedError("bad")),
    ).toBe("schema_mismatch");
  });

  it("prefers 'truncated_output' over 'schema_mismatch' so the retry class drives the label", () => {
    // TruncationRetryFailedError is what generateArticleDraft surfaces
    // when at least the final attempt was a truncation. The
    // orchestrator must stamp `failureKind: "truncated_output"` for
    // these (NOT schema_mismatch) so dashboards/alerts can tell the
    // two failure modes apart.
    const truncation = new TruncatedArticleOutputError({
      actualWords: 5,
      expectedWords: 1500,
      finishReason: "length",
      contentMarkdownPreview: "x",
    });
    const retry = new TruncationRetryFailedError({
      originalError: truncation,
      retryError: truncation,
      retryCount: 1,
    });
    expect(getArticleGenerationFailureKind(retry)).toBe("truncated_output");
  });

  it("returns null for unrelated errors", () => {
    expect(
      getArticleGenerationFailureKind(new Error("rate_limit_exceeded")),
    ).toBeNull();
    expect(getArticleGenerationFailureKind(undefined)).toBeNull();
  });
});

describe("TruncationRetryFailedError", () => {
  it("carries both inner errors and exposes the retry metadata", () => {
    const first = new TruncatedArticleOutputError({
      actualWords: 100,
      expectedWords: 2000,
      finishReason: "stop",
      contentMarkdownPreview: "first preview",
    });
    const second = new TruncatedArticleOutputError({
      actualWords: 80,
      expectedWords: 2000,
      finishReason: "length",
      contentMarkdownPreview: "second preview",
    });
    const err = new TruncationRetryFailedError({
      originalError: first,
      retryError: second,
      retryCount: 1,
    });
    expect(err.kind).toBe("truncated_output");
    expect(err.retried).toBe(true);
    expect(err.retryCount).toBe(1);
    expect(err.originalError).toBe(first);
    expect(err.retryError).toBe(second);
    expect(err.originalErrorMessage).toContain("actualWords=100");
    expect(err.finalErrorMessage).toContain("actualWords=80");
    expect(err.message).toContain("Original:");
    expect(err.message).toContain("Final:");
  });
});

describe("generateArticleDraft — truncation retry", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  /** Builds a truncated draft (~30 words, claims 2000 words). */
  function truncatedDraftStub() {
    return {
      ...draftStub,
      contentMarkdown:
        "# Truncated\n\nThe model started writing this article and then stopped mid-sentence which is exactly what the production hiccup looked like and",
      wordCount: 2000,
    };
  }

  it("retries with the stricter system suffix when the first attempt is truncated, returning retried=true on success", async () => {
    // First call → truncated draft. Second call → healthy default.
    generateTextMock
      .mockResolvedValueOnce({
        output: truncatedDraftStub(),
        usage: {
          inputTokens: 1500,
          outputTokens: 200,
          inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: {},
        },
        finishReason: "length",
      })
      .mockResolvedValueOnce({
        output: draftStub,
        usage: {
          inputTokens: 1500,
          outputTokens: 850,
          inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: {},
        },
        finishReason: "stop",
      });

    const result = await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(result.retried).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(result.finishReason).toBe("stop");
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    // Truncation should have logged exactly one structured warn line
    // for the first attempt; the successful retry must NOT warn.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toBe(
      "article_generation_truncation_detected",
    );
  });

  it("throws TruncationRetryFailedError when both attempts are truncated, carrying both inner errors", async () => {
    generateTextMock
      .mockResolvedValueOnce({
        output: truncatedDraftStub(),
        usage: {
          inputTokens: 1500,
          outputTokens: 200,
          inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: {},
        },
        finishReason: "length",
      })
      .mockResolvedValueOnce({
        output: truncatedDraftStub(),
        usage: {
          inputTokens: 1500,
          outputTokens: 250,
          inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: {},
        },
        finishReason: "length",
      });

    let caught: unknown;
    try {
      await generateArticleDraft({
        blogName: "Acme",
        settings: buildSettings(),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TruncationRetryFailedError);
    const err = caught as TruncationRetryFailedError;
    expect(err.retried).toBe(true);
    expect(err.retryCount).toBe(1);
    expect(err.originalError).toBeInstanceOf(TruncatedArticleOutputError);
    expect(err.retryError).toBeInstanceOf(TruncatedArticleOutputError);
  });

  it("escalates a schema-then-truncation sequence as TruncationRetryFailedError (final attempt drives the label)", async () => {
    generateTextMock
      .mockRejectedValueOnce(makeNoObjectGeneratedError("response did not match schema"))
      .mockResolvedValueOnce({
        output: truncatedDraftStub(),
        usage: {
          inputTokens: 1500,
          outputTokens: 200,
          inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: {},
        },
        finishReason: "length",
      });

    let caught: unknown;
    try {
      await generateArticleDraft({
        blogName: "Acme",
        settings: buildSettings(),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TruncationRetryFailedError);
  });

  it("passes ARTICLE_MAX_OUTPUT_TOKENS as maxOutputTokens to every Claude call", async () => {
    await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
    });
    const call = generateTextMock.mock.calls[0]![0] as {
      maxOutputTokens: number;
    };
    expect(call.maxOutputTokens).toBe(ARTICLE_MAX_OUTPUT_TOKENS);
  });

  it("does NOT trip the truncation guard on a healthy short article (just above the floor)", async () => {
    // 320-word draftStub with wordCount=320 → ratio 1.0, above floor.
    // This is the default happy path but explicit so a future floor
    // bump can't silently break legitimate short articles.
    void ARTICLE_TRUNCATION_WORD_FLOOR; // keep import live
    const result = await generateArticleDraft({
      blogName: "Acme",
      settings: buildSettings(),
    });
    expect(result.retried).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Idea generation
// ============================================================================

const ideasStub = {
  ideas: [
    {
      title: "How to ship faster with durable execution",
      slug: "how-to-ship-faster-with-durable-execution",
      targetKeyword: "durable execution",
      executiveSummary:
        "A practical guide to using durable workflows to accelerate shipping cycles for engineering teams.",
      articleType: "how_to",
      estimatedWordCount: 1500,
    },
    {
      title: "5 mistakes teams make when adopting AI agents",
      slug: "5-mistakes-teams-make-when-adopting-ai-agents",
      targetKeyword: "AI agents adoption",
      executiveSummary:
        "Common pitfalls and how to avoid them when rolling out AI agents internally.",
      articleType: "listicle",
      estimatedWordCount: 1200,
    },
  ],
};

describe("buildIdeasPromptParts", () => {
  it("asks the model for exactly the requested count", () => {
    const { prompt } = buildIdeasPromptParts({
      blogName: "Acme",
      settings: buildSettings(),
      count: 7,
    });

    expect(prompt).toContain("Generate exactly 7 distinct article ideas");
    expect(prompt).toContain("exactly 7 entries");
  });

  it("incorporates the blog identity, tone, goals, and preferred article types", () => {
    const settings = buildSettings({
      identity: {
        ...DEFAULT_BLOG_SETTINGS.identity,
        audience: "platform engineers",
        tone: "wry, technical, opinionated",
      },
      strategy: {
        ...DEFAULT_BLOG_SETTINGS.strategy,
        goals: ["rank", "leads"],
        preferredArticleTypes: ["how_to", "case_study"],
      },
    });

    const { system } = buildIdeasPromptParts({
      blogName: "WorkflowLab",
      settings,
      count: IDEA_DEFAULT_COUNT,
    });

    expect(system).toContain('"WorkflowLab"');
    expect(system).toContain("platform engineers");
    expect(system).toContain("wry, technical, opinionated");
    expect(system).toContain("rank, leads");
    expect(system).toContain("how_to, case_study");
  });

  it("uses the brief as a seed when provided", () => {
    const { prompt } = buildIdeasPromptParts({
      blogName: "Acme",
      settings: buildSettings(),
      brief: "  durable workflows for AI agents  ",
      count: 10,
    });

    expect(prompt).toContain("Topic seed from the user");
    expect(prompt).toContain("durable workflows for AI agents");
    expect(prompt).not.toContain("  durable workflows");
  });

  it("falls back to picking on-strategy topics when no brief is provided", () => {
    const { prompt } = buildIdeasPromptParts({
      blogName: "Acme",
      settings: buildSettings(),
      count: 10,
    });

    expect(prompt).toContain("No specific topic seed was provided");
    expect(prompt).not.toContain("Topic seed from the user");
  });

  it("treats whitespace-only briefs as no brief", () => {
    const { prompt } = buildIdeasPromptParts({
      blogName: "Acme",
      settings: buildSettings(),
      brief: "   \n   ",
      count: 10,
    });

    expect(prompt).toContain("No specific topic seed was provided");
  });

  it("includes existing titles to avoid duplicates", () => {
    const { prompt } = buildIdeasPromptParts({
      blogName: "Acme",
      settings: buildSettings(),
      existingTitles: ["Why durable execution matters", "Vercel Workflows 101"],
      count: 5,
    });

    expect(prompt).toContain("Avoid duplicating");
    expect(prompt).toContain("Why durable execution matters");
    expect(prompt).toContain("Vercel Workflows 101");
  });

  it("omits the avoid line when no existing titles are provided", () => {
    const { prompt } = buildIdeasPromptParts({
      blogName: "Acme",
      settings: buildSettings(),
      count: 5,
    });

    expect(prompt).not.toContain("Avoid duplicating");
  });

  it("includes positive/negative AI guardrails when the blog defines them", () => {
    const settings = buildSettings({
      ai: {
        ...DEFAULT_BLOG_SETTINGS.ai,
        positivePrompt: "Lean into specific data points.",
        negativePrompt: "Avoid generic 'in 2026' clickbait.",
      },
    });

    const { system } = buildIdeasPromptParts({
      blogName: "Acme",
      settings,
      count: 5,
    });

    expect(system).toContain("DO: Lean into specific data points.");
    expect(system).toContain("DO NOT: Avoid generic 'in 2026' clickbait.");
  });

  it("appends the blog owner's custom system prompt when set", () => {
    const settings = buildSettings({
      advanced: {
        ...DEFAULT_BLOG_SETTINGS.advanced,
        customSystemPrompt: "Always cite primary sources.",
      },
    });

    const { system } = buildIdeasPromptParts({
      blogName: "Acme",
      settings,
      count: 5,
    });

    expect(system).toContain("Additional instructions from the blog owner");
    expect(system).toContain("Always cite primary sources.");
  });

  it("includes topics-to-cover and topics-to-avoid when provided", () => {
    const settings = buildSettings({
      strategy: {
        ...DEFAULT_BLOG_SETTINGS.strategy,
        topicsToCover: "AI agents, durable workflows",
        topicsToAvoid: "crypto",
      },
    });

    const { prompt } = buildIdeasPromptParts({
      blogName: "Acme",
      settings,
      count: 5,
    });

    expect(prompt).toContain("Topics the blog wants covered");
    expect(prompt).toContain("AI agents, durable workflows");
    expect(prompt).toContain("Topics to avoid");
    expect(prompt).toContain("crypto");
  });

  it("includes the blog description when present", () => {
    const { system } = buildIdeasPromptParts({
      blogName: "Acme",
      blogDescription: "A blog about durable workflows on Vercel.",
      settings: buildSettings(),
      count: 5,
    });

    expect(system).toContain("A blog about durable workflows on Vercel.");
  });

  it("falls back to a generic format note when no preferred types are set", () => {
    const settings = buildSettings({
      strategy: {
        ...DEFAULT_BLOG_SETTINGS.strategy,
        preferredArticleTypes: [],
        goals: [],
      },
    });

    const { system } = buildIdeasPromptParts({
      blogName: "Acme",
      settings,
      count: 5,
    });

    expect(system).toContain("any of the supported types");
    expect(system).toContain("general thought leadership");
  });

  it("includes selected AI/SEO/advanced guidance when set", () => {
    const settings = buildSettings({
      ai: {
        ...DEFAULT_BLOG_SETTINGS.ai,
        approvedTerminology: "workflow, durable",
        bannedTerminology: "hack",
        defaultArticleStructure: "Problem → solution → checklist",
        preferredCta: "Book a demo",
      },
      seo: {
        ...DEFAULT_BLOG_SETTINGS.seo,
        defaultHeadingsStructure: "Question-style H2s",
        faqSection: true,
      },
      advanced: {
        ...DEFAULT_BLOG_SETTINGS.advanced,
        competitorsToAvoid: "BigCorp",
        internalLinksToPrioritize: "docs/getting-started",
      },
    });
    const { system, prompt } = buildIdeasPromptParts({
      blogName: "Acme",
      settings,
      count: 5,
    });
    expect(system).toContain("workflow, durable");
    expect(system).toContain("Avoid these terms/phrases");
    expect(system).toContain("hack");
    expect(system).toContain("Problem → solution → checklist");
    expect(system).toContain("Book a demo");
    expect(system).toContain("Question-style H2s");
    expect(system).toContain("FAQ section");
    expect(system).toContain("BigCorp");
    expect(prompt).toContain("docs/getting-started");
  });

  it("omits idea guidance bullets when related settings are blank", () => {
    const { system, prompt } = buildIdeasPromptParts({
      blogName: "Acme",
      settings: buildSettings({
        seo: { ...DEFAULT_BLOG_SETTINGS.seo, faqSection: false },
      }),
      count: 5,
    });
    expect(system).not.toContain("Prefer these terms/phrases");
    expect(system).not.toContain("Typical article shape");
    expect(system).not.toContain("FAQ section");
    expect(prompt).not.toContain("internal themes");
  });

  it("includes blog niche and keywords in the ideas system prompt when set", () => {
    const { system } = buildIdeasPromptParts({
      blogName: "Acme",
      blogNiche: "AI productivity",
      blogKeywords: ["prompt engineering", "agents"],
      settings: buildSettings(),
      count: 5,
    });
    expect(system).toContain("Blog niche/category: AI productivity.");
    expect(system).toContain("Primary keywords to consider");
    expect(system).toContain("prompt engineering, agents");
    expect(system).toContain("do not stuff every keyword");
  });

  it("omits niche and keyword lines from ideas prompt when unset", () => {
    const { system } = buildIdeasPromptParts({
      blogName: "Acme",
      settings: buildSettings(),
      count: 5,
    });
    expect(system).not.toContain("Blog niche/category:");
    expect(system).not.toContain("Primary keywords to consider");
  });

  it("omits keyword line from ideas prompt when all keywords are blank", () => {
    const { system } = buildIdeasPromptParts({
      blogName: "Acme",
      blogKeywords: ["  "],
      settings: buildSettings(),
      count: 5,
    });
    expect(system).not.toContain("Primary keywords to consider");
  });

  it("appends legacy ai_prompt_template to ideas system prompt when set", () => {
    const { system } = buildIdeasPromptParts({
      blogName: "Acme",
      legacyAiPromptTemplate: "Prefer listicle angles.",
      settings: buildSettings(),
      count: 5,
    });
    expect(system).toContain("Legacy blog-level prompt guidance");
    expect(system).toContain("Prefer listicle angles.");
  });
});

describe("generateIdeas", () => {
  beforeEach(() => {
    generateTextMock.mockResolvedValue({
      output: ideasStub,
      usage: {
        inputTokens: 800,
        outputTokens: 600,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokenDetails: {},
      },
    });
  });

  it("calls generateText with the configured Haiku model when none is provided", async () => {
    await generateIdeas({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(anthropicCallable).toHaveBeenCalledWith(AI_MODELS.ideaGeneration);
    expect(generateTextMock).toHaveBeenCalledOnce();
  });

  it("threads a custom model id through to the provider", async () => {
    await generateIdeas({
      blogName: "Acme",
      settings: buildSettings(),
      model: "claude-sonnet-4-6",
    });

    expect(anthropicCallable).toHaveBeenCalledWith("claude-sonnet-4-6");
  });

  it("uses an injected anthropic provider when supplied", async () => {
    const injected = vi.fn(
      (modelId: string) => ({ __injected: modelId }) as never,
    );

    await generateIdeas({
      blogName: "Acme",
      settings: buildSettings(),
      anthropicProvider: injected as never,
    });

    expect(injected).toHaveBeenCalledWith(AI_MODELS.ideaGeneration);
    expect(anthropicCallable).not.toHaveBeenCalled();
  });

  it("attaches the structured output schema with a stable name", async () => {
    await generateIdeas({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(outputObjectMock).toHaveBeenCalledOnce();
    const arg = outputObjectMock.mock.calls[0]![0] as {
      name: string;
      description: string;
    };
    expect(arg.name).toBe("article_ideas_batch");
    expect(arg.description).toMatch(/article ideas/i);
  });

  it("defaults the count to IDEA_DEFAULT_COUNT in the prompt", async () => {
    await generateIdeas({
      blogName: "Acme",
      settings: buildSettings(),
    });

    const call = generateTextMock.mock.calls[0]![0] as { prompt: string };
    expect(call.prompt).toContain(
      `Generate exactly ${IDEA_DEFAULT_COUNT} distinct article ideas`,
    );
  });

  it("respects a custom count", async () => {
    await generateIdeas({
      blogName: "Acme",
      settings: buildSettings(),
      count: 3,
    });

    const call = generateTextMock.mock.calls[0]![0] as { prompt: string };
    expect(call.prompt).toContain("Generate exactly 3 distinct article ideas");
  });

  it("returns the parsed ideas with model id and token usage", async () => {
    const result = await generateIdeas({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(result.ideas).toEqual(ideasStub.ideas);
    expect(result.model).toBe(AI_MODELS.ideaGeneration);
    expect(result.promptTokens).toBe(800);
    expect(result.completionTokens).toBe(600);
    expect(result.cachedReadTokens).toBe(0);
    expect(result.cachedWriteTokens).toBe(0);
  });

  it("normalizes missing token counts to null", async () => {
    generateTextMock.mockResolvedValueOnce({
      output: ideasStub,
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {},
      },
    });

    const result = await generateIdeas({
      blogName: "Acme",
      settings: buildSettings(),
    });

    expect(result.promptTokens).toBeNull();
    expect(result.completionTokens).toBeNull();
    expect(result.cachedReadTokens).toBeNull();
    expect(result.cachedWriteTokens).toBeNull();
  });

  it("propagates SDK errors", async () => {
    const FakeError = NoObjectGeneratedError as unknown as new (
      message: string,
    ) => Error;
    generateTextMock.mockRejectedValueOnce(new FakeError("schema mismatch"));

    await expect(
      generateIdeas({
        blogName: "Acme",
        settings: buildSettings(),
      }),
    ).rejects.toThrow(/schema mismatch/);
  });
});
