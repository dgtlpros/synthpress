import { describe, expect, it } from "vitest";
import {
  DEFAULT_BLOG_SETTINGS,
  loadBlogSettings,
  mergeBlogSettings,
} from "./blog-settings";

describe("loadBlogSettings", () => {
  it("returns defaults when input is null", () => {
    expect(loadBlogSettings(null)).toEqual(DEFAULT_BLOG_SETTINGS);
  });

  it("returns defaults when input is undefined", () => {
    expect(loadBlogSettings(undefined)).toEqual(DEFAULT_BLOG_SETTINGS);
  });

  it("returns defaults when input is not an object", () => {
    expect(loadBlogSettings("nope")).toEqual(DEFAULT_BLOG_SETTINGS);
    expect(loadBlogSettings(42)).toEqual(DEFAULT_BLOG_SETTINGS);
    expect(loadBlogSettings([])).toEqual(DEFAULT_BLOG_SETTINGS);
  });

  it("preserves valid string fields", () => {
    const out = loadBlogSettings({
      identity: { audience: "Indie hackers", tone: "Punchy" },
    });
    expect(out.identity.audience).toBe("Indie hackers");
    expect(out.identity.tone).toBe("Punchy");
    expect(out.identity.language).toBe(DEFAULT_BLOG_SETTINGS.identity.language);
  });

  it("falls back to default when enums are invalid", () => {
    const out = loadBlogSettings({
      identity: { readingLevel: "phd-level" },
      seo: { keywordUsage: "hyperaggressive" },
    });
    expect(out.identity.readingLevel).toBe("intermediate");
    expect(out.seo.keywordUsage).toBe("balanced");
  });

  it("filters arrays to expected types", () => {
    const out = loadBlogSettings({
      strategy: { goals: ["educate", "rank", "not-a-goal", 42] },
      automation: { preferredDays: ["Mon", "Tue", null, "Wed"] },
    });
    expect(out.strategy.goals).toEqual(["educate", "rank"]);
    expect(out.automation.preferredDays).toEqual(["Mon", "Tue", "Wed"]);
  });

  it("preserves valid numeric fields", () => {
    const out = loadBlogSettings({
      seo: { defaultArticleLength: 2400 },
    });
    expect(out.seo.defaultArticleLength).toBe(2400);
  });

  it("ignores NaN / non-finite numbers", () => {
    const out = loadBlogSettings({
      seo: { defaultArticleLength: Number.NaN },
    });
    expect(out.seo.defaultArticleLength).toBe(
      DEFAULT_BLOG_SETTINGS.seo.defaultArticleLength,
    );
  });

  it("preserves valid boolean fields", () => {
    const out = loadBlogSettings({
      seo: { faqSection: true, schemaMarkup: true },
      automation: { requireReview: false },
    });
    expect(out.seo.faqSection).toBe(true);
    expect(out.seo.schemaMarkup).toBe(true);
    expect(out.automation.requireReview).toBe(false);
  });

  it("ignores unrecognized top-level sections", () => {
    const out = loadBlogSettings({
      identity: { audience: "Devs" },
      mystery: { foo: "bar" },
    } as never);
    expect(out.identity.audience).toBe("Devs");
    // No surprise extra keys.
    expect(Object.keys(out)).toEqual(Object.keys(DEFAULT_BLOG_SETTINGS));
  });

  it("falls back when an enum field is a non-string", () => {
    const out = loadBlogSettings({
      identity: { readingLevel: 42 },
      seo: { keywordUsage: false, slugFormat: null },
    } as never);
    expect(out.identity.readingLevel).toBe("intermediate");
    expect(out.seo.keywordUsage).toBe("balanced");
    expect(out.seo.slugFormat).toBe("lowercase-hyphenated");
  });

  it("normalizes valid values across every section", () => {
    const out = loadBlogSettings({
      identity: {
        audience: "x",
        language: "es",
        tone: "y",
        readingLevel: "advanced",
        pointOfView: "first_person_plural",
        defaultAuthorPersona: "Editor",
      },
      strategy: {
        goals: ["rank", "leads"],
        monetization: "ads",
        competitors: "site.com",
        contentFreshness: "trending",
        preferredArticleTypes: ["how_to", "comparison"],
        topicsToCover: "A",
        topicsToAvoid: "B",
      },
      ai: {
        positivePrompt: "p",
        negativePrompt: "n",
        approvedTerminology: "ok",
        bannedTerminology: "ban",
        exampleArticleStyle: "style",
        defaultArticleStructure: "outline",
        preferredCta: "cta",
      },
      seo: {
        strategy: "long-tail",
        metaDescriptionStyle: "short",
        keywordUsage: "aggressive",
        internalLinkingPreference: "aggressive",
        externalLinkingPreference: "none",
        slugFormat: "title-case",
        titleFormat: "{T}",
        defaultArticleLength: 1800,
        defaultHeadingsStructure: "H2",
        faqSection: true,
        schemaMarkup: true,
        featuredImagePreference: "always",
      },
      automation: {
        mode: "autopilot",
        enabled: true,
        generatePerWeek: 14,
        requireReview: false,
        autoSchedule: true,
        preferredDays: ["Mon", "Wed", "Fri"],
        publishWindowStart: "07:00",
        publishWindowEnd: "19:00",
        timezone: "UTC",
        maxPostsPerDay: 4,
        regenerateOnFail: false,
        backlogThreshold: 25,
        dailyTokenBudget: 1000,
        pausedReason: "failure_rate",
        pausedAt: "2026-05-11T12:00:00.000Z",
        pausedMessage: "Autopilot was paused.",
      },
      publishing: {
        defaultDestination: "wordpress",
        defaultStatus: "scheduled",
        defaultCategory: "tech",
        defaultTags: ["a", "b"],
        defaultAuthor: "alice",
        uploadFeaturedImage: false,
        updateExistingPosts: true,
      },
      media: {
        generateFeaturedImage: true,
        imageStylePrompt: "soft",
        imageSource: "manual_upload",
        generateAltText: false,
        defaultImageDimensions: "800x600",
        includeInlineImages: true,
      },
      advanced: {
        customSystemPrompt: "system",
        customArticleTemplate: "tmpl",
        customOutlineTemplate: "outline",
        defaultDisclaimer: "disc",
        affiliateDisclosure: "aff",
        internalLinksToPrioritize: "x",
        competitorsToAvoid: "y",
      },
    });
    expect(out.identity.pointOfView).toBe("first_person_plural");
    expect(out.strategy.goals).toEqual(["rank", "leads"]);
    expect(out.ai.preferredCta).toBe("cta");
    expect(out.seo.featuredImagePreference).toBe("always");
    expect(out.automation.mode).toBe("autopilot");
    expect(out.automation.enabled).toBe(true);
    expect(out.automation.backlogThreshold).toBe(25);
    expect(out.automation.dailyTokenBudget).toBe(1000);
    expect(out.automation.pausedReason).toBe("failure_rate");
    expect(out.automation.pausedAt).toBe("2026-05-11T12:00:00.000Z");
    expect(out.automation.pausedMessage).toBe("Autopilot was paused.");
    expect(out.publishing.defaultDestination).toBe("wordpress");
    expect(out.media.imageSource).toBe("manual_upload");
    expect(out.advanced.competitorsToAvoid).toBe("y");
  });

  it("defaults autopilot kill-switch / backlog / budget to safe values", () => {
    expect(DEFAULT_BLOG_SETTINGS.automation.enabled).toBe(false);
    expect(DEFAULT_BLOG_SETTINGS.automation.backlogThreshold).toBe(10);
    expect(DEFAULT_BLOG_SETTINGS.automation.dailyTokenBudget).toBeNull();
  });

  it("defaults the autopilot pause-metadata fields to null (no pause)", () => {
    expect(DEFAULT_BLOG_SETTINGS.automation.pausedReason).toBeNull();
    expect(DEFAULT_BLOG_SETTINGS.automation.pausedAt).toBeNull();
    expect(DEFAULT_BLOG_SETTINGS.automation.pausedMessage).toBeNull();
  });

  it("defaults autopilot image picker to ON with Unsplash", () => {
    expect(DEFAULT_BLOG_SETTINGS.media.autoPickImages).toBe(true);
    expect(DEFAULT_BLOG_SETTINGS.media.imageProvider).toBe("unsplash");
  });

  it("defaults autopilot WordPress draft send to OFF (opt-in posture)", () => {
    expect(DEFAULT_BLOG_SETTINGS.publishing.autoSendToWordPressDraft).toBe(
      false,
    );
  });

  it("normalizes valid publishing.autoSendToWordPressDraft", () => {
    const out = loadBlogSettings({
      publishing: { autoSendToWordPressDraft: true },
    });
    expect(out.publishing.autoSendToWordPressDraft).toBe(true);
  });

  it("falls back to default when publishing.autoSendToWordPressDraft is the wrong type", () => {
    const out = loadBlogSettings({
      publishing: { autoSendToWordPressDraft: "yes" },
    } as never);
    expect(out.publishing.autoSendToWordPressDraft).toBe(false);
  });

  it("preserves the rest of publishing when only autoSendToWordPressDraft is supplied", () => {
    const out = loadBlogSettings({
      publishing: { autoSendToWordPressDraft: true },
    });
    expect(out.publishing.autoSendToWordPressDraft).toBe(true);
    expect(out.publishing.defaultDestination).toBe(
      DEFAULT_BLOG_SETTINGS.publishing.defaultDestination,
    );
    expect(out.publishing.uploadFeaturedImage).toBe(
      DEFAULT_BLOG_SETTINGS.publishing.uploadFeaturedImage,
    );
  });

  it("normalizes valid media.autoPickImages + media.imageProvider", () => {
    const out = loadBlogSettings({
      media: { autoPickImages: false, imageProvider: "none" },
    });
    expect(out.media.autoPickImages).toBe(false);
    expect(out.media.imageProvider).toBe("none");
  });

  it("falls back to defaults when media.imageProvider is an unknown value", () => {
    const out = loadBlogSettings({
      media: { imageProvider: "midjourney" },
    });
    expect(out.media.imageProvider).toBe("unsplash");
  });

  it("falls back to defaults when media.autoPickImages is the wrong type", () => {
    const out = loadBlogSettings({
      media: { autoPickImages: "yes" },
    } as never);
    expect(out.media.autoPickImages).toBe(true);
  });

  it("preserves the rest of media when only the new keys are supplied", () => {
    const out = loadBlogSettings({
      media: { autoPickImages: false },
    });
    expect(out.media.autoPickImages).toBe(false);
    // Other keys keep their defaults.
    expect(out.media.imageProvider).toBe(DEFAULT_BLOG_SETTINGS.media.imageProvider);
    expect(out.media.imageSource).toBe(DEFAULT_BLOG_SETTINGS.media.imageSource);
    expect(out.media.generateAltText).toBe(
      DEFAULT_BLOG_SETTINGS.media.generateAltText,
    );
  });

  it("preserves explicit null pause-metadata values (means: not paused)", () => {
    const out = loadBlogSettings({
      automation: {
        pausedReason: null,
        pausedAt: null,
        pausedMessage: null,
      },
    } as never);
    expect(out.automation.pausedReason).toBeNull();
    expect(out.automation.pausedAt).toBeNull();
    expect(out.automation.pausedMessage).toBeNull();
  });

  it("preserves valid string pause-metadata values from a paused blog", () => {
    const out = loadBlogSettings({
      automation: {
        pausedReason: "failure_rate",
        pausedAt: "2026-05-11T12:00:00.000Z",
        pausedMessage:
          "Autopilot was paused because multiple recent runs failed.",
      },
    } as never);
    expect(out.automation.pausedReason).toBe("failure_rate");
    expect(out.automation.pausedAt).toBe("2026-05-11T12:00:00.000Z");
    expect(out.automation.pausedMessage).toMatch(/multiple recent runs/);
  });

  it("falls back to default when pause-metadata fields are non-string non-null", () => {
    const out = loadBlogSettings({
      automation: { pausedReason: 42 },
    } as never);
    expect(out.automation.pausedReason).toBe(
      DEFAULT_BLOG_SETTINGS.automation.pausedReason,
    );
  });

  it("preserves an explicit null dailyTokenBudget (means: no per-blog cap)", () => {
    const out = loadBlogSettings({
      automation: { dailyTokenBudget: null },
    } as never);
    expect(out.automation.dailyTokenBudget).toBeNull();
  });

  it("falls back to default when dailyTokenBudget is a non-number, non-null", () => {
    const out = loadBlogSettings({
      automation: { dailyTokenBudget: "lots" },
    } as never);
    expect(out.automation.dailyTokenBudget).toBe(
      DEFAULT_BLOG_SETTINGS.automation.dailyTokenBudget,
    );
  });

  it("falls back to default when dailyTokenBudget is a non-finite number", () => {
    const out = loadBlogSettings({
      automation: { dailyTokenBudget: Number.NaN },
    } as never);
    expect(out.automation.dailyTokenBudget).toBe(
      DEFAULT_BLOG_SETTINGS.automation.dailyTokenBudget,
    );
  });

  it("falls back when whole sections are non-objects", () => {
    const out = loadBlogSettings({
      identity: "not-an-object",
      strategy: 42,
      ai: null,
      seo: [],
      automation: true,
      publishing: undefined,
      media: "x",
      advanced: 0,
    } as never);
    expect(out).toEqual(DEFAULT_BLOG_SETTINGS);
  });
});

describe("mergeBlogSettings", () => {
  it("merges shallow patches per section", () => {
    const merged = mergeBlogSettings(DEFAULT_BLOG_SETTINGS, {
      identity: { audience: "Founders" },
    });
    expect(merged.identity.audience).toBe("Founders");
    expect(merged.identity.tone).toBe(DEFAULT_BLOG_SETTINGS.identity.tone);
    expect(merged.seo).toEqual(DEFAULT_BLOG_SETTINGS.seo);
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(DEFAULT_BLOG_SETTINGS);
    mergeBlogSettings(DEFAULT_BLOG_SETTINGS, {
      seo: { faqSection: true },
    });
    expect(JSON.stringify(DEFAULT_BLOG_SETTINGS)).toBe(before);
  });

  it("can patch multiple sections at once", () => {
    const merged = mergeBlogSettings(DEFAULT_BLOG_SETTINGS, {
      identity: { tone: "Witty" },
      seo: { defaultArticleLength: 1800 },
      automation: { mode: "autopilot" },
    });
    expect(merged.identity.tone).toBe("Witty");
    expect(merged.seo.defaultArticleLength).toBe(1800);
    expect(merged.automation.mode).toBe("autopilot");
  });
});
