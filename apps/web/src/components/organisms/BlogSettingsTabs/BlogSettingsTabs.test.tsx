import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";
import {
  BlogSettingsTabs,
  type BlogSettingsTabsValue,
} from "./BlogSettingsTabs";

afterEach(cleanup);

function makeValue(
  overrides: Partial<BlogSettingsTabsValue> = {},
): BlogSettingsTabsValue {
  return {
    general: {
      name: "Indie",
      description: "Built in public.",
      niche: "indie hackers",
      keywordsText: "indie, micro-saas",
      aiPromptTemplate: "",
    },
    settings: DEFAULT_BLOG_SETTINGS,
    ...overrides,
  };
}

describe("BlogSettingsTabs", () => {
  it("renders the General tab by default", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/Blog name/)).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "General", selected: true }),
    ).toBeInTheDocument();
  });

  it("disables Save when the form is pristine", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("enables Save when a field is dirtied", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Blog name/), {
      target: { value: "New name" },
    });
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).not.toBeDisabled();
  });

  it("calls onSave with the dirty value", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/Blog name/), {
      target: { value: "New name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0][0].general.name).toBe("New name");
  });

  it("resets the form when Discard is clicked", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    const input = screen.getByLabelText(/Blog name/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(input.value).toBe("Indie");
  });

  it("switches to other tabs and shows their fields", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "AI instructions" }));
    expect(screen.getByLabelText("Positive prompt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "SEO" }));
    expect(screen.getByLabelText("Slug format")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    expect(screen.getByLabelText("Mode")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Publishing" }));
    expect(screen.getByLabelText("Destination")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Media" }));
    expect(screen.getByLabelText("Image source")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByLabelText("Custom system prompt")).toBeInTheDocument();
  });

  it("toggles content goal pills on the Strategy tab", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Content strategy" }));
    const rank = screen.getByRole("button", { name: /Rank on Google/ });
    expect(rank).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(rank);
    expect(rank).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a saved-success status when saveSuccess and not dirty", () => {
    render(
      <BlogSettingsTabs
        initialValue={makeValue()}
        onSave={vi.fn()}
        saveSuccess
      />,
    );
    expect(screen.getByText("All changes saved.")).toBeInTheDocument();
  });

  it("shows an error status when error is provided", () => {
    render(
      <BlogSettingsTabs
        initialValue={makeValue()}
        onSave={vi.fn()}
        error="Could not save."
      />,
    );
    expect(screen.getByText("Could not save.")).toBeInTheDocument();
  });

  it("gates auto-publishing controls behind a Coming Soon panel", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    expect(screen.getByText(/Coming soon/)).toBeInTheDocument();
    expect(screen.getByText(/WordPress connection/)).toBeInTheDocument();
    // None of the publishing-only controls are rendered.
    expect(
      screen.queryByLabelText(/Publish window \(start\)/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sat" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /Auto-schedule new drafts/ }),
    ).not.toBeInTheDocument();
  });

  it("toggles boolean settings via switch toggles", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "SEO" }));
    const faqToggle = screen.getByRole("switch", {
      name: /Include FAQ section/,
    });
    expect(faqToggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(faqToggle);
    expect(faqToggle).toHaveAttribute("aria-checked", "true");
  });

  it("resets internal state when initialValue prop changes", () => {
    const { rerender } = render(
      <BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Blog name/), {
      target: { value: "Dirty" },
    });
    rerender(
      <BlogSettingsTabs
        initialValue={makeValue({
          general: {
            name: "Renamed",
            description: "Built in public.",
            niche: "indie hackers",
            keywordsText: "indie, micro-saas",
            aiPromptTemplate: "",
          },
        })}
        onSave={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(/Blog name/) as HTMLInputElement).value).toBe(
      "Renamed",
    );
  });

  // ─── General tab ─────────────────────────────────────────────────────────

  it("edits General tab fields (description, niche, audience, keywords, persona)", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "New desc" },
    });
    fireEvent.change(screen.getByLabelText(/Niche/), {
      target: { value: "AI" },
    });
    fireEvent.change(screen.getByLabelText(/Target audience/), {
      target: { value: "Developers" },
    });
    fireEvent.change(screen.getByLabelText(/Primary keywords/), {
      target: { value: "ai, ml" },
    });
    fireEvent.change(screen.getByLabelText(/Default author/), {
      target: { value: "Editor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalled();
    const v = onSave.mock.calls[0][0];
    expect(v.general.description).toBe("New desc");
    expect(v.general.niche).toBe("AI");
    expect(v.settings.identity.audience).toBe("Developers");
    expect(v.general.keywordsText).toBe("ai, ml");
    expect(v.settings.identity.defaultAuthorPersona).toBe("Editor");
  });

  it("edits Voice & tone fields (tone, language, reading level, POV)", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/tone/i), {
      target: { value: "Punchy" },
    });
    fireEvent.change(screen.getByLabelText(/Primary language/), {
      target: { value: "es" },
    });
    fireEvent.change(screen.getByLabelText(/Reading level/), {
      target: { value: "advanced" },
    });
    fireEvent.change(screen.getByLabelText(/Point of view/), {
      target: { value: "first_person_plural" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.identity.tone).toBe("Punchy");
    expect(v.settings.identity.language).toBe("es");
    expect(v.settings.identity.readingLevel).toBe("advanced");
    expect(v.settings.identity.pointOfView).toBe("first_person_plural");
  });

  // ─── Strategy tab ────────────────────────────────────────────────────────

  it("toggles a goal pill OFF when it was already on", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Content strategy" }));
    // 'educate' is on by default in DEFAULT_BLOG_SETTINGS
    const educate = screen.getByRole("button", { name: /Educate/ });
    expect(educate).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(educate);
    expect(educate).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles preferred article type pills on and off", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Content strategy" }));
    // 'how_to' is on by default
    const howTo = screen.getByRole("button", { name: /How-to guides/ });
    expect(howTo).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(howTo);
    expect(howTo).toHaveAttribute("aria-pressed", "false");
    // and turn one back ON
    const review = screen.getByRole("button", { name: /^Reviews$/ });
    expect(review).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(review);
    expect(review).toHaveAttribute("aria-pressed", "true");
  });

  it("edits strategy text fields and selects", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Content strategy" }));
    fireEvent.change(screen.getByLabelText(/Topics to cover/), {
      target: { value: "Topic A" },
    });
    fireEvent.change(screen.getByLabelText(/Topics to avoid/), {
      target: { value: "Topic B" },
    });
    fireEvent.change(screen.getByLabelText(/Monetization/), {
      target: { value: "affiliate" },
    });
    fireEvent.change(screen.getByLabelText(/Content freshness/), {
      target: { value: "trending" },
    });
    fireEvent.change(screen.getByLabelText(/Competitors/), {
      target: { value: "site.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.strategy.topicsToCover).toBe("Topic A");
    expect(v.settings.strategy.topicsToAvoid).toBe("Topic B");
    expect(v.settings.strategy.monetization).toBe("affiliate");
    expect(v.settings.strategy.contentFreshness).toBe("trending");
    expect(v.settings.strategy.competitors).toBe("site.com");
  });

  // ─── AI instructions tab ─────────────────────────────────────────────────

  it("edits all AI instruction fields", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "AI instructions" }));
    fireEvent.change(screen.getByLabelText(/Positive prompt/), {
      target: { value: "be punchy" },
    });
    fireEvent.change(screen.getByLabelText(/Negative prompt/), {
      target: { value: "no fluff" },
    });
    fireEvent.change(screen.getByLabelText(/Approved terminology/), {
      target: { value: "ship, learn" },
    });
    fireEvent.change(screen.getByLabelText(/Banned words/), {
      target: { value: "synergy" },
    });
    fireEvent.change(screen.getByLabelText(/Default article structure/), {
      target: { value: "Hook → Body → CTA" },
    });
    fireEvent.change(screen.getByLabelText(/Example article style/), {
      target: { value: "Style sample" },
    });
    fireEvent.change(screen.getByLabelText(/Preferred CTA/), {
      target: { value: "Subscribe" },
    });
    fireEvent.change(screen.getByLabelText(/Legacy AI prompt template/), {
      target: { value: "{{TOPIC}}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.ai.positivePrompt).toBe("be punchy");
    expect(v.settings.ai.negativePrompt).toBe("no fluff");
    expect(v.settings.ai.approvedTerminology).toBe("ship, learn");
    expect(v.settings.ai.bannedTerminology).toBe("synergy");
    expect(v.settings.ai.defaultArticleStructure).toBe("Hook → Body → CTA");
    expect(v.settings.ai.exampleArticleStyle).toBe("Style sample");
    expect(v.settings.ai.preferredCta).toBe("Subscribe");
    expect(v.general.aiPromptTemplate).toBe("{{TOPIC}}");
  });

  // ─── SEO tab ─────────────────────────────────────────────────────────────

  it("edits SEO tab fields and toggles", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "SEO" }));
    fireEvent.change(screen.getByLabelText(/SEO strategy/), {
      target: { value: "long-tail" },
    });
    fireEvent.change(screen.getByLabelText(/Title format/), {
      target: { value: "{Topic}" },
    });
    fireEvent.change(screen.getByLabelText(/Slug format/), {
      target: { value: "title-case" },
    });
    fireEvent.change(screen.getByLabelText(/Default article length/), {
      target: { value: "2200" },
    });
    fireEvent.change(screen.getByLabelText(/Meta description style/), {
      target: { value: "Punchy 140-160 chars." },
    });
    fireEvent.change(screen.getByLabelText(/Default headings structure/), {
      target: { value: "H2/H3" },
    });
    fireEvent.change(screen.getByLabelText(/Keyword usage/), {
      target: { value: "aggressive" },
    });
    fireEvent.change(screen.getByLabelText(/Internal linking/), {
      target: { value: "aggressive" },
    });
    fireEvent.change(screen.getByLabelText(/External linking/), {
      target: { value: "none" },
    });
    fireEvent.change(screen.getByLabelText(/Featured image preference/), {
      target: { value: "always" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: /Include FAQ section/ }),
    );
    fireEvent.click(screen.getByRole("switch", { name: /Schema.org markup/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.seo.strategy).toBe("long-tail");
    expect(v.settings.seo.titleFormat).toBe("{Topic}");
    expect(v.settings.seo.slugFormat).toBe("title-case");
    expect(v.settings.seo.defaultArticleLength).toBe(2200);
    expect(v.settings.seo.metaDescriptionStyle).toBe("Punchy 140-160 chars.");
    expect(v.settings.seo.defaultHeadingsStructure).toBe("H2/H3");
    expect(v.settings.seo.keywordUsage).toBe("aggressive");
    expect(v.settings.seo.internalLinkingPreference).toBe("aggressive");
    expect(v.settings.seo.externalLinkingPreference).toBe("none");
    expect(v.settings.seo.featuredImagePreference).toBe("always");
    expect(v.settings.seo.faqSection).toBe(true);
    expect(v.settings.seo.schemaMarkup).toBe(true);
  });

  it("falls back to 1200 when default article length is empty", () => {
    const onSave = vi.fn();
    const initial = makeValue();
    initial.settings = {
      ...initial.settings,
      seo: { ...initial.settings.seo, defaultArticleLength: 1800 },
    };
    render(<BlogSettingsTabs initialValue={initial} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "SEO" }));
    fireEvent.change(screen.getByLabelText(/Default article length/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave.mock.calls[0][0].settings.seo.defaultArticleLength).toBe(
      1200,
    );
  });

  // ─── Automation tab ──────────────────────────────────────────────────────

  it("edits Automation tab inputs and toggles", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    fireEvent.click(screen.getByRole("switch", { name: /Autopilot enabled/ }));
    fireEvent.change(screen.getByLabelText("Mode"), {
      target: { value: "autopilot" },
    });
    fireEvent.change(screen.getByLabelText(/Generate per week/), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText(/Max drafts \/ day/), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText(/Timezone/), {
      target: { value: "UTC" },
    });
    fireEvent.change(screen.getByLabelText(/Approved-idea backlog target/), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText(/Daily Synth-token budget/), {
      target: { value: "500" },
    });
    fireEvent.click(
      screen.getByRole("switch", {
        name: /Require review before autopilot creates articles/,
      }),
    );
    fireEvent.click(
      screen.getByRole("switch", { name: /Auto-regenerate failed drafts/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.automation.enabled).toBe(true);
    expect(v.settings.automation.mode).toBe("autopilot");
    expect(v.settings.automation.generatePerWeek).toBe(20);
    expect(v.settings.automation.maxPostsPerDay).toBe(5);
    expect(v.settings.automation.timezone).toBe("UTC");
    expect(v.settings.automation.backlogThreshold).toBe(25);
    expect(v.settings.automation.dailyTokenBudget).toBe(500);
    expect(v.settings.automation.requireReview).toBe(false);
    expect(v.settings.automation.regenerateOnFail).toBe(false);
  });

  it("uses the review-on copy when requireReview=true (default)", () => {
    // Default DEFAULT_BLOG_SETTINGS.automation.requireReview is true.
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));

    expect(
      screen.getByText(
        /Generated ideas must be approved before autopilot creates articles/i,
      ),
    ).toBeInTheDocument();
  });

  it("uses the hands-off copy when requireReview=false", () => {
    render(
      <BlogSettingsTabs
        initialValue={makeValue({
          settings: {
            ...DEFAULT_BLOG_SETTINGS,
            automation: {
              ...DEFAULT_BLOG_SETTINGS.automation,
              requireReview: false,
            },
          },
        })}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));

    expect(
      screen.getByText(
        /Autopilot can approve its own ideas and generate article drafts automatically/i,
      ),
    ).toBeInTheDocument();
  });

  it("falls back to 0 when generate-per-week, max-drafts, and backlog are empty", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    fireEvent.change(screen.getByLabelText(/Generate per week/), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText(/Max drafts \/ day/), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText(/Approved-idea backlog target/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.automation.generatePerWeek).toBe(0);
    expect(v.settings.automation.maxPostsPerDay).toBe(0);
    expect(v.settings.automation.backlogThreshold).toBe(0);
  });

  it("treats a blank daily-token-budget input as null (no per-blog cap)", () => {
    const onSave = vi.fn();
    const initial = makeValue();
    initial.settings = {
      ...initial.settings,
      automation: { ...initial.settings.automation, dailyTokenBudget: 250 },
    };
    render(<BlogSettingsTabs initialValue={initial} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    fireEvent.change(screen.getByLabelText(/Daily Synth-token budget/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.automation.dailyTokenBudget).toBeNull();
  });

  it("falls back to null when daily-token-budget is a negative number", () => {
    const onSave = vi.fn();
    const initial = makeValue();
    initial.settings = {
      ...initial.settings,
      automation: { ...initial.settings.automation, dailyTokenBudget: 250 },
    };
    render(<BlogSettingsTabs initialValue={initial} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    fireEvent.change(screen.getByLabelText(/Daily Synth-token budget/), {
      target: { value: "-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.automation.dailyTokenBudget).toBeNull();
  });

  // ─── Publishing tab ──────────────────────────────────────────────────────

  it("edits Publishing tab fields and toggles", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Publishing" }));
    fireEvent.change(screen.getByLabelText("Destination"), {
      target: { value: "wordpress" },
    });
    fireEvent.change(screen.getByLabelText("Default status"), {
      target: { value: "scheduled" },
    });
    fireEvent.change(screen.getByLabelText(/Default author \(CMS\)/), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText(/Default category/), {
      target: { value: "tech" },
    });
    fireEvent.change(screen.getByLabelText(/Default tags/), {
      target: { value: " ai , tooling , , growth " },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: /Upload featured image/ }),
    );
    fireEvent.click(
      screen.getByRole("switch", { name: /Update existing posts/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.publishing.defaultDestination).toBe("wordpress");
    expect(v.settings.publishing.defaultStatus).toBe("scheduled");
    expect(v.settings.publishing.defaultAuthor).toBe("alice");
    expect(v.settings.publishing.defaultCategory).toBe("tech");
    expect(v.settings.publishing.defaultTags).toEqual([
      "ai",
      "tooling",
      "growth",
    ]);
    expect(v.settings.publishing.uploadFeaturedImage).toBe(false);
    expect(v.settings.publishing.updateExistingPosts).toBe(true);
  });

  // ─── Media tab ───────────────────────────────────────────────────────────

  it("edits Media tab fields and toggles", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Media" }));
    fireEvent.click(
      screen.getByRole("switch", { name: /Generate a featured image/ }),
    );
    fireEvent.click(screen.getByRole("switch", { name: /Generate alt text/ }));
    fireEvent.click(
      screen.getByRole("switch", { name: /Inline images in body/ }),
    );
    fireEvent.change(screen.getByLabelText(/Image source/), {
      target: { value: "manual_upload" },
    });
    fireEvent.change(screen.getByLabelText(/Default image dimensions/), {
      target: { value: "800x600" },
    });
    fireEvent.change(screen.getByLabelText(/Image style prompt/), {
      target: { value: "Soft pastels" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.media.generateFeaturedImage).toBe(true);
    expect(v.settings.media.generateAltText).toBe(false);
    expect(v.settings.media.includeInlineImages).toBe(true);
    expect(v.settings.media.imageSource).toBe("manual_upload");
    expect(v.settings.media.defaultImageDimensions).toBe("800x600");
    expect(v.settings.media.imageStylePrompt).toBe("Soft pastels");
  });

  // ─── Advanced tab ────────────────────────────────────────────────────────

  it("edits Advanced tab fields", () => {
    const onSave = vi.fn();
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText(/Custom system prompt/), {
      target: { value: "system" },
    });
    fireEvent.change(screen.getByLabelText(/Custom outline template/), {
      target: { value: "outline" },
    });
    fireEvent.change(screen.getByLabelText(/Custom article template/), {
      target: { value: "article" },
    });
    fireEvent.change(screen.getByLabelText(/Default disclaimer/), {
      target: { value: "disclaimer" },
    });
    fireEvent.change(screen.getByLabelText(/Affiliate disclosure/), {
      target: { value: "affiliate" },
    });
    fireEvent.change(screen.getByLabelText(/Internal links to prioritize/), {
      target: { value: "links" },
    });
    fireEvent.change(screen.getByLabelText(/Competitors to avoid linking to/), {
      target: { value: "comps" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const v = onSave.mock.calls[0][0];
    expect(v.settings.advanced.customSystemPrompt).toBe("system");
    expect(v.settings.advanced.customOutlineTemplate).toBe("outline");
    expect(v.settings.advanced.customArticleTemplate).toBe("article");
    expect(v.settings.advanced.defaultDisclaimer).toBe("disclaimer");
    expect(v.settings.advanced.affiliateDisclosure).toBe("affiliate");
    expect(v.settings.advanced.internalLinksToPrioritize).toBe("links");
    expect(v.settings.advanced.competitorsToAvoid).toBe("comps");
  });

  it("shows the unsaved-changes status when dirty", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Blog name/), {
      target: { value: "Edited" },
    });
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
  });

  it("disables Discard when not dirty", () => {
    render(<BlogSettingsTabs initialValue={makeValue()} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });
});
