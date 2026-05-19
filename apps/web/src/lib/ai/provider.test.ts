import { beforeEach, describe, expect, it, vi } from "vitest";
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
  buildArticlePromptParts,
  buildIdeasPromptParts,
  createAnthropicProvider,
  generateArticleDraft,
  generateIdeas,
  IDEA_DEFAULT_COUNT,
  isStructuredArticleGenerationSchemaError,
  NoObjectGeneratedError,
  resolveAnthropic,
  SchemaRetryFailedError,
  STRICT_SCHEMA_REPAIR_INSTRUCTION,
} from "./provider";
import { AI_MODELS } from "./models";

const draftStub = {
  title: "How to launch a B2B blog in 30 days",
  slug: "how-to-launch-a-b2b-blog-in-30-days",
  excerpt: "A practical 30-day plan to ship your first ten posts.",
  metaDescription:
    "Step-by-step playbook for launching a B2B blog in 30 days, with weekly milestones.",
  contentMarkdown:
    "# How to launch a B2B blog in 30 days\n\nLaunching a B2B blog is mostly about discipline. " +
    "Here's the four-week plan we use with our clients to ship the first ten posts.\n\n" +
    "## Week 1: positioning\n\nStart by clarifying the audience...\n",
  targetKeyword: "launch a b2b blog",
  wordCount: 1234,
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
    expect(prompt).not.toContain("Topics the blog wants covered");
    expect(prompt).not.toContain("Topics to avoid");
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
