"use client";

import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/atoms/Badge";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import { Input } from "@/components/atoms/Input";
import { Label } from "@/components/atoms/Label";
import { Select } from "@/components/atoms/Select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/atoms/Tabs";
import { Textarea } from "@/components/atoms/Textarea";
import { Toggle } from "@/components/atoms/Toggle";
import {
  ARTICLE_TYPE_OPTIONS,
  type BlogContentGoal,
  type BlogSettings,
  CONTENT_GOAL_OPTIONS,
} from "@/lib/blog-settings";

export interface BlogSettingsTabsValue {
  /** General fields stored as columns on `blogs`. */
  general: {
    name: string;
    description: string;
    niche: string;
    keywordsText: string;
    aiPromptTemplate: string;
  };
  /** Everything that lives in `blogs.settings` jsonb. */
  settings: BlogSettings;
}

export interface BlogSettingsTabsProps {
  initialValue: BlogSettingsTabsValue;
  isSaving?: boolean;
  error?: string | null;
  saveSuccess?: boolean;
  /**
   * Called with the full diff between the dirty form value and the initial
   * value. Caller is responsible for sending the correct payload to the
   * server action.
   */
  onSave: (next: BlogSettingsTabsValue) => void | Promise<void>;
  /**
   * `true` iff the blog has all three WordPress credential fields
   * stored. Computed in the parent server component so we don't
   * re-query Supabase from the tabs. Today only the Publishing
   * tab uses this — the "auto-send to WP draft" toggle disables
   * itself + shows a helper line when the connection is missing.
   * Defaults to `false` if omitted (legacy callers).
   */
  hasWordPressConnection?: boolean;
  className?: string;
}

const TAB_DEFS = [
  { value: "general", label: "General" },
  { value: "strategy", label: "Content strategy" },
  { value: "ai", label: "AI instructions" },
  { value: "seo", label: "SEO" },
  { value: "automation", label: "Automation" },
  { value: "publishing", label: "Publishing" },
  { value: "media", label: "Media" },
  { value: "advanced", label: "Advanced" },
] as const;

type TabValue = (typeof TAB_DEFS)[number]["value"];

const TAB_VALUES = new Set<string>(TAB_DEFS.map((t) => t.value));

function tabFromLocationHash(hash: string): TabValue | null {
  const id = hash.replace(/^#/, "");
  return TAB_VALUES.has(id) ? (id as TabValue) : null;
}

export function BlogSettingsTabs({
  initialValue,
  isSaving,
  error,
  saveSuccess,
  onSave,
  hasWordPressConnection = false,
  className,
}: BlogSettingsTabsProps) {
  const [tab, setTab] = useState<TabValue>("general");
  const [value, setValue] = useState<BlogSettingsTabsValue>(initialValue);

  // Deep links such as `…/settings#automation` (Autopilot panel helper).
  useEffect(() => {
    function syncTabFromHash() {
      const fromHash = tabFromLocationHash(window.location.hash);
      if (fromHash) setTab(fromHash);
    }
    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, []);

  function handleTabChange(next: string) {
    const tabValue = next as TabValue;
    setTab(tabValue);
    const nextUrl = `${window.location.pathname}${window.location.search}#${tabValue}`;
    window.history.replaceState(null, "", nextUrl);
  }
  // Reset state when a "fresh load" (different fingerprint) arrives — the
  // React docs' recommended pattern instead of an effect.
  // https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes
  const initialKey = JSON.stringify(initialValue);
  const [prevInitialKey, setPrevInitialKey] = useState(initialKey);
  if (prevInitialKey !== initialKey) {
    setPrevInitialKey(initialKey);
    setValue(initialValue);
  }

  const isDirty = JSON.stringify(value) !== initialKey;

  function patchGeneral(patch: Partial<BlogSettingsTabsValue["general"]>) {
    setValue((v) => ({ ...v, general: { ...v.general, ...patch } }));
  }
  function patchSettings<K extends keyof BlogSettings>(
    section: K,
    patch: Partial<BlogSettings[K]>,
  ) {
    setValue((v) => ({
      ...v,
      settings: {
        ...v.settings,
        [section]: { ...v.settings[section], ...patch },
      },
    }));
  }

  return (
    <div className={cn("space-y-4", className)}>
      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        orientation="vertical"
        className="md:!flex-row"
      >
        <Card className="md:max-w-[15rem] md:flex-1 p-3">
          <TabsList ariaLabel="Settings sections">
            {TAB_DEFS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Card>

        <div className="min-w-0 flex-1">
          <TabsContent value="general" className="space-y-6">
            <GeneralTab
              value={value}
              identity={value.settings.identity}
              onChangeGeneral={patchGeneral}
              onChangeIdentity={(p) => patchSettings("identity", p)}
            />
          </TabsContent>

          <TabsContent value="strategy" className="space-y-6">
            <StrategyTab
              value={value.settings.strategy}
              onChange={(p) => patchSettings("strategy", p)}
            />
          </TabsContent>

          <TabsContent value="ai" className="space-y-6">
            <AiTab
              value={value.settings.ai}
              promptTemplate={value.general.aiPromptTemplate}
              onChangePromptTemplate={(t) =>
                patchGeneral({ aiPromptTemplate: t })
              }
              onChange={(p) => patchSettings("ai", p)}
            />
          </TabsContent>

          <TabsContent value="seo" className="space-y-6">
            <SeoTab
              value={value.settings.seo}
              onChange={(p) => patchSettings("seo", p)}
            />
          </TabsContent>

          <TabsContent value="automation" id="automation" className="space-y-6">
            <AutomationTab
              value={value.settings.automation}
              onChange={(p) => patchSettings("automation", p)}
            />
          </TabsContent>

          <TabsContent value="publishing" className="space-y-6">
            <PublishingTab
              value={value.settings.publishing}
              onChange={(p) => patchSettings("publishing", p)}
              hasWordPressConnection={hasWordPressConnection}
            />
          </TabsContent>

          <TabsContent value="media" className="space-y-6">
            <MediaTab
              value={value.settings.media}
              onChange={(p) => patchSettings("media", p)}
            />
          </TabsContent>

          <TabsContent value="advanced" className="space-y-6">
            <AdvancedTab
              value={value.settings.advanced}
              onChange={(p) => patchSettings("advanced", p)}
            />
          </TabsContent>
        </div>
      </Tabs>

      <Card
        className="sticky bottom-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        variant="default"
      >
        <div className="text-sm" role="status" aria-live="polite">
          {error ? (
            <span className="text-error">{error}</span>
          ) : saveSuccess && !isDirty ? (
            <span className="text-success">All changes saved.</span>
          ) : isDirty ? (
            <span className="text-muted">You have unsaved changes.</span>
          ) : (
            <span className="text-muted">No changes yet.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => setValue(initialValue)}
            disabled={!isDirty || isSaving}
          >
            Discard
          </Button>
          <Button
            size="md"
            loading={isSaving}
            disabled={!isDirty}
            onClick={() => onSave(value)}
          >
            Save changes
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Sections ───────────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </header>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /**
   * When `true`, the underlying `<Toggle>` is non-interactive (the
   * browser ignores click + keyboard) and the row dims to half
   * opacity. Used by the autopilot-WP-draft toggle when the blog
   * has no WordPress connection — the description text swaps to a
   * "Connect WordPress first" hint at the call site.
   */
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4",
        disabled ? "opacity-60" : null,
      )}
    >
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        aria-label={label}
        disabled={disabled}
      />
    </div>
  );
}

// ─── General + Identity ─────────────────────────────────────────────────────

function GeneralTab({
  value,
  identity,
  onChangeGeneral,
  onChangeIdentity,
}: {
  value: BlogSettingsTabsValue;
  identity: BlogSettings["identity"];
  onChangeGeneral: (p: Partial<BlogSettingsTabsValue["general"]>) => void;
  onChangeIdentity: (p: Partial<BlogSettings["identity"]>) => void;
}) {
  return (
    <>
      <Section
        title="Blog identity"
        description="The basics that show up in headers and feed into every piece of generated content."
      >
        <Field label="Blog name" htmlFor="blog-name" required>
          <Input
            id="blog-name"
            value={value.general.name}
            onChange={(e) => onChangeGeneral({ name: e.target.value })}
          />
        </Field>
        <Field
          label="Description"
          htmlFor="blog-description"
          hint="Shown in headers and used as a baseline context for the AI."
        >
          <Textarea
            id="blog-description"
            value={value.general.description}
            onChange={(e) => onChangeGeneral({ description: e.target.value })}
            rows={3}
            placeholder="One or two sentences about what this blog is."
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Niche / category"
            htmlFor="blog-niche"
            hint="Used as high-level context for generated ideas and articles. e.g. Indie SaaS, AI productivity."
          >
            <Input
              id="blog-niche"
              value={value.general.niche}
              onChange={(e) => onChangeGeneral({ niche: e.target.value })}
            />
          </Field>
          <Field
            label="Target audience"
            htmlFor="blog-audience"
            hint="Who you're writing for."
          >
            <Input
              id="blog-audience"
              value={identity.audience}
              onChange={(e) => onChangeIdentity({ audience: e.target.value })}
              placeholder="e.g. Indie hackers, marketing leads"
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Primary keywords"
            htmlFor="blog-keywords"
            hint="Used as topic and SEO guidance for idea and article generation. SynthPress uses them naturally — not every keyword in every post."
          >
            <Textarea
              id="blog-keywords"
              value={value.general.keywordsText}
              onChange={(e) =>
                onChangeGeneral({ keywordsText: e.target.value })
              }
              rows={3}
              placeholder="ai blogging, content automation, ..."
            />
          </Field>
          <Field
            label="Default author / persona"
            htmlFor="blog-author-persona"
            hint="Used as the default author when generating new posts."
          >
            <Input
              id="blog-author-persona"
              value={identity.defaultAuthorPersona}
              onChange={(e) =>
                onChangeIdentity({ defaultAuthorPersona: e.target.value })
              }
              placeholder="Editorial team"
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Voice & tone"
        description="How the blog should sound on the page. Applied to every generated post."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Brand voice / tone" htmlFor="blog-tone">
            <Input
              id="blog-tone"
              value={identity.tone}
              onChange={(e) => onChangeIdentity({ tone: e.target.value })}
              placeholder="e.g. Punchy, conversational, expert"
            />
          </Field>
          <Field label="Primary language" htmlFor="blog-language">
            <Select
              id="blog-language"
              value={identity.language}
              onChange={(e) => onChangeIdentity({ language: e.target.value })}
              options={[
                { value: "en", label: "English" },
                { value: "es", label: "Español" },
                { value: "fr", label: "Français" },
                { value: "de", label: "Deutsch" },
                { value: "pt", label: "Português" },
                { value: "ja", label: "日本語" },
              ]}
            />
          </Field>
          <Field label="Reading level" htmlFor="blog-reading-level">
            <Select
              id="blog-reading-level"
              value={identity.readingLevel}
              onChange={(e) =>
                onChangeIdentity({
                  readingLevel: e.target
                    .value as BlogSettings["identity"]["readingLevel"],
                })
              }
              options={[
                { value: "elementary", label: "Elementary" },
                { value: "intermediate", label: "Intermediate" },
                { value: "advanced", label: "Advanced" },
                { value: "expert", label: "Expert" },
              ]}
            />
          </Field>
          <Field label="Point of view" htmlFor="blog-pov">
            <Select
              id="blog-pov"
              value={identity.pointOfView}
              onChange={(e) =>
                onChangeIdentity({
                  pointOfView: e.target
                    .value as BlogSettings["identity"]["pointOfView"],
                })
              }
              options={[
                { value: "first_person_singular", label: "First person (I)" },
                { value: "first_person_plural", label: "First person (We)" },
                { value: "second_person", label: "Second person (You)" },
                { value: "third_person", label: "Third person" },
                { value: "editorial", label: "Editorial" },
              ]}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}

// ─── Strategy ───────────────────────────────────────────────────────────────

function StrategyTab({
  value,
  onChange,
}: {
  value: BlogSettings["strategy"];
  onChange: (p: Partial<BlogSettings["strategy"]>) => void;
}) {
  function toggleGoal(goal: BlogContentGoal) {
    onChange({
      goals: value.goals.includes(goal)
        ? value.goals.filter((g) => g !== goal)
        : [...value.goals, goal],
    });
  }
  function toggleArticleType(t: string) {
    onChange({
      preferredArticleTypes: value.preferredArticleTypes.includes(t)
        ? value.preferredArticleTypes.filter((x) => x !== t)
        : [...value.preferredArticleTypes, t],
    });
  }

  return (
    <>
      <Section
        title="Content goals"
        description="Pick anything that applies. The AI will optimize for these outcomes."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {CONTENT_GOAL_OPTIONS.map((g) => {
            const isActive = value.goals.includes(g.value);
            return (
              <button
                key={g.value}
                type="button"
                onClick={() => toggleGoal(g.value)}
                aria-pressed={isActive}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-[var(--sp-radius-lg)] border p-3 text-left transition-colors",
                  isActive
                    ? "border-brand-blue bg-brand-blue/5"
                    : "border-border bg-surface hover:border-border-hover",
                )}
              >
                <span className="text-sm font-medium text-foreground">
                  {g.label}
                </span>
                <span className="text-xs text-muted">{g.description}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Topics"
        description="Tell the AI exactly what to write about — and what to leave alone."
      >
        <Field
          label="Topics to cover"
          htmlFor="strategy-topics-cover"
          hint="One topic per line."
        >
          <Textarea
            id="strategy-topics-cover"
            value={value.topicsToCover}
            onChange={(e) => onChange({ topicsToCover: e.target.value })}
            rows={4}
            placeholder={
              "How to ship faster\nFounder mental models\nDistribution strategies"
            }
          />
        </Field>
        <Field
          label="Topics to avoid"
          htmlFor="strategy-topics-avoid"
          hint="One topic per line."
        >
          <Textarea
            id="strategy-topics-avoid"
            value={value.topicsToAvoid}
            onChange={(e) => onChange({ topicsToAvoid: e.target.value })}
            rows={3}
            placeholder={"Crypto speculation\nUnverified medical claims"}
          />
        </Field>
      </Section>

      <Section
        title="Article types"
        description="Which formats should appear most often?"
      >
        <div className="flex flex-wrap gap-2">
          {ARTICLE_TYPE_OPTIONS.map((t) => {
            const isActive = value.preferredArticleTypes.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => toggleArticleType(t.value)}
                aria-pressed={isActive}
                className={cn(
                  "rounded-[var(--sp-radius-full)] border px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "border-brand-blue bg-brand-blue/10 text-foreground"
                    : "border-border bg-surface text-muted hover:border-border-hover hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Context"
        description="Optional — but the AI will use this if you provide it."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Monetization" htmlFor="strategy-monetization">
            <Input
              id="strategy-monetization"
              value={value.monetization}
              onChange={(e) => onChange({ monetization: e.target.value })}
              placeholder="ads, affiliate, leads, brand awareness"
            />
          </Field>
          <Field label="Content freshness" htmlFor="strategy-freshness">
            <Select
              id="strategy-freshness"
              value={value.contentFreshness}
              onChange={(e) =>
                onChange({
                  contentFreshness: e.target
                    .value as BlogSettings["strategy"]["contentFreshness"],
                })
              }
              options={[
                { value: "evergreen", label: "Evergreen" },
                { value: "trending", label: "Trending" },
                { value: "news", label: "News" },
                { value: "tutorial", label: "Tutorial" },
              ]}
            />
          </Field>
        </div>
        <Field
          label="Competitors / inspiration sites"
          htmlFor="strategy-competitors"
          hint="One URL or name per line. Used as context, never linked to."
        >
          <Textarea
            id="strategy-competitors"
            value={value.competitors}
            onChange={(e) => onChange({ competitors: e.target.value })}
            rows={3}
          />
        </Field>
      </Section>
    </>
  );
}

// ─── AI Instructions ────────────────────────────────────────────────────────

function AiTab({
  value,
  promptTemplate,
  onChangePromptTemplate,
  onChange,
}: {
  value: BlogSettings["ai"];
  promptTemplate: string;
  onChangePromptTemplate: (t: string) => void;
  onChange: (p: Partial<BlogSettings["ai"]>) => void;
}) {
  return (
    <>
      <Section
        title="The fingerprint"
        description="Two short instructions that have an outsized effect on tone and behavior."
      >
        <Field
          label="Positive prompt"
          htmlFor="ai-positive"
          hint="What the AI should do, prioritize, or include."
        >
          <Textarea
            id="ai-positive"
            value={value.positivePrompt}
            onChange={(e) => onChange({ positivePrompt: e.target.value })}
            rows={4}
            placeholder="Write punchy intros, use concrete examples, link to sources, prioritize first-hand experience."
          />
        </Field>
        <Field
          label="Negative prompt"
          htmlFor="ai-negative"
          hint="What the AI should avoid."
        >
          <Textarea
            id="ai-negative"
            value={value.negativePrompt}
            onChange={(e) => onChange({ negativePrompt: e.target.value })}
            rows={3}
            placeholder="Avoid AI clichés, no overuse of em-dashes, never invent statistics."
          />
        </Field>
      </Section>

      <Section
        title="Vocabulary"
        description="Word lists keep generated copy on-brand and out of the legal danger zone."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Approved terminology"
            htmlFor="ai-approved"
            hint="Comma-separated. The AI will prefer these terms."
          >
            <Textarea
              id="ai-approved"
              value={value.approvedTerminology}
              onChange={(e) =>
                onChange({ approvedTerminology: e.target.value })
              }
              rows={3}
            />
          </Field>
          <Field
            label="Banned words / phrases"
            htmlFor="ai-banned"
            hint="Comma-separated. The AI will avoid these."
          >
            <Textarea
              id="ai-banned"
              value={value.bannedTerminology}
              onChange={(e) => onChange({ bannedTerminology: e.target.value })}
              rows={3}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Article structure"
        description="Set sensible defaults — every post can still override these."
      >
        <Field
          label="Default article structure"
          htmlFor="ai-structure"
          hint="A simple outline (e.g. Hook → Why it matters → 5 steps → CTA)."
        >
          <Textarea
            id="ai-structure"
            value={value.defaultArticleStructure}
            onChange={(e) =>
              onChange({ defaultArticleStructure: e.target.value })
            }
            rows={3}
          />
        </Field>
        <Field
          label="Example article style"
          htmlFor="ai-style"
          hint="Paste 1–2 paragraphs that capture the voice you want."
        >
          <Textarea
            id="ai-style"
            value={value.exampleArticleStyle}
            onChange={(e) => onChange({ exampleArticleStyle: e.target.value })}
            rows={5}
          />
        </Field>
        <Field
          label="Preferred CTA"
          htmlFor="ai-cta"
          hint="The default call-to-action at the end of every post."
        >
          <Input
            id="ai-cta"
            value={value.preferredCta}
            onChange={(e) => onChange({ preferredCta: e.target.value })}
            placeholder="Subscribe to the weekly newsletter →"
          />
        </Field>
        <Field
          label="Legacy AI prompt template"
          htmlFor="ai-template"
          hint="Legacy prompt guidance appended after other instructions. Prefer Advanced → Custom system prompt for new setup."
        >
          <Textarea
            id="ai-template"
            value={promptTemplate}
            onChange={(e) => onChangePromptTemplate(e.target.value)}
            rows={6}
            className="font-mono text-xs"
          />
        </Field>
      </Section>
    </>
  );
}

// ─── SEO ────────────────────────────────────────────────────────────────────

function SeoTab({
  value,
  onChange,
}: {
  value: BlogSettings["seo"];
  onChange: (p: Partial<BlogSettings["seo"]>) => void;
}) {
  return (
    <>
      <Section
        title="SEO defaults"
        description="Applied to every generated post unless overridden manually."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="SEO strategy" htmlFor="seo-strategy">
            <Input
              id="seo-strategy"
              value={value.strategy}
              onChange={(e) => onChange({ strategy: e.target.value })}
              placeholder="e.g. long-tail keyword expansion"
            />
          </Field>
          <Field label="Title format" htmlFor="seo-title-format">
            <Input
              id="seo-title-format"
              value={value.titleFormat}
              onChange={(e) => onChange({ titleFormat: e.target.value })}
              placeholder="{Topic}: {Hook} — {Brand}"
            />
          </Field>
          <Field label="Slug format" htmlFor="seo-slug-format">
            <Select
              id="seo-slug-format"
              value={value.slugFormat}
              onChange={(e) =>
                onChange({
                  slugFormat: e.target
                    .value as BlogSettings["seo"]["slugFormat"],
                })
              }
              options={[
                {
                  value: "lowercase-hyphenated",
                  label: "lowercase-hyphenated",
                },
                { value: "title-case", label: "Title-Case" },
                { value: "short-id", label: "short-id (no slug)" },
              ]}
            />
          </Field>
          <Field label="Default article length (words)" htmlFor="seo-length">
            <Input
              id="seo-length"
              type="number"
              min={300}
              step={100}
              value={value.defaultArticleLength}
              onChange={(e) =>
                onChange({
                  defaultArticleLength: Number(e.target.value) || 1200,
                })
              }
            />
          </Field>
        </div>
        <Field
          label="Meta description style"
          htmlFor="seo-meta-style"
          hint="One sentence the AI follows when generating meta descriptions."
        >
          <Input
            id="seo-meta-style"
            value={value.metaDescriptionStyle}
            onChange={(e) => onChange({ metaDescriptionStyle: e.target.value })}
            placeholder="Punchy, 140–160 chars, ends with a question."
          />
        </Field>
        <Field
          label="Default headings structure"
          htmlFor="seo-headings"
          hint="Defaults the H2/H3 outline shape."
        >
          <Textarea
            id="seo-headings"
            value={value.defaultHeadingsStructure}
            onChange={(e) =>
              onChange({ defaultHeadingsStructure: e.target.value })
            }
            rows={3}
            placeholder={
              "H2 Why this matters\nH2 5 steps\nH3 ...\nH2 What's next"
            }
          />
        </Field>
      </Section>

      <Section
        title="Linking & on-page SEO"
        description="How aggressive should the AI be with links and metadata?"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Keyword usage" htmlFor="seo-keyword-usage">
            <Select
              id="seo-keyword-usage"
              value={value.keywordUsage}
              onChange={(e) =>
                onChange({
                  keywordUsage: e.target
                    .value as BlogSettings["seo"]["keywordUsage"],
                })
              }
              options={[
                { value: "natural", label: "Natural" },
                { value: "balanced", label: "Balanced" },
                { value: "aggressive", label: "Aggressive" },
              ]}
            />
          </Field>
          <Field label="Internal linking" htmlFor="seo-internal-linking">
            <Select
              id="seo-internal-linking"
              value={value.internalLinkingPreference}
              onChange={(e) =>
                onChange({
                  internalLinkingPreference: e.target
                    .value as BlogSettings["seo"]["internalLinkingPreference"],
                })
              }
              options={[
                { value: "none", label: "None" },
                { value: "occasional", label: "Occasional" },
                { value: "aggressive", label: "Aggressive" },
              ]}
            />
          </Field>
          <Field label="External linking" htmlFor="seo-external-linking">
            <Select
              id="seo-external-linking"
              value={value.externalLinkingPreference}
              onChange={(e) =>
                onChange({
                  externalLinkingPreference: e.target
                    .value as BlogSettings["seo"]["externalLinkingPreference"],
                })
              }
              options={[
                { value: "none", label: "None" },
                { value: "occasional", label: "Occasional" },
                { value: "aggressive", label: "Aggressive" },
              ]}
            />
          </Field>
          <Field label="Featured image preference" htmlFor="seo-featured-image">
            <Select
              id="seo-featured-image"
              value={value.featuredImagePreference}
              onChange={(e) =>
                onChange({
                  featuredImagePreference: e.target
                    .value as BlogSettings["seo"]["featuredImagePreference"],
                })
              }
              options={[
                { value: "always", label: "Always" },
                { value: "when_relevant", label: "When relevant" },
                { value: "never", label: "Never" },
              ]}
            />
          </Field>
        </div>
        <ToggleField
          label="Include FAQ section"
          description="Adds a question/answer block to the bottom of every article."
          checked={value.faqSection}
          onChange={(faqSection) => onChange({ faqSection })}
        />
        <ToggleField
          label="Schema.org markup"
          description="Output JSON-LD structured data for richer search results."
          checked={value.schemaMarkup}
          onChange={(schemaMarkup) => onChange({ schemaMarkup })}
        />
      </Section>
    </>
  );
}

// ─── Automation ─────────────────────────────────────────────────────────────

function AutomationTab({
  value,
  onChange,
}: {
  value: BlogSettings["automation"];
  onChange: (p: Partial<BlogSettings["automation"]>) => void;
}) {
  return (
    <>
      <Section
        title="Autopilot"
        description="The kill switch and content-generation cadence for AI-driven drafts."
      >
        <ToggleField
          label="Autopilot enabled"
          description="When on, the scheduler may generate ideas and drafts on its own. Turn off to pause without losing your configuration."
          checked={value.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Mode" htmlFor="automation-mode">
            <Select
              id="automation-mode"
              value={value.mode}
              onChange={(e) =>
                onChange({
                  mode: e.target.value as BlogSettings["automation"]["mode"],
                })
              }
              options={[
                { value: "manual", label: "Manual — I create posts" },
                {
                  value: "autopilot",
                  label: "Autopilot — AI generates posts",
                },
              ]}
            />
          </Field>
          <Field
            label="Generate per week"
            htmlFor="automation-per-week"
            hint="Target draft count per week. Autopilot won't exceed this."
          >
            <Input
              id="automation-per-week"
              type="number"
              min={0}
              max={50}
              value={value.generatePerWeek}
              onChange={(e) =>
                onChange({ generatePerWeek: Number(e.target.value) || 0 })
              }
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Max drafts / day"
            htmlFor="automation-max-per-day"
            hint="Hard upper bound for a single day. Stops a backlog burst."
          >
            <Input
              id="automation-max-per-day"
              type="number"
              min={0}
              max={50}
              value={value.maxPostsPerDay}
              onChange={(e) =>
                onChange({ maxPostsPerDay: Number(e.target.value) || 0 })
              }
            />
          </Field>
          <Field
            label="Timezone"
            htmlFor="automation-timezone"
            hint="IANA timezone name, e.g. Etc/UTC, America/New_York."
          >
            <Input
              id="automation-timezone"
              value={value.timezone}
              onChange={(e) => onChange({ timezone: e.target.value })}
              placeholder="Etc/UTC"
            />
          </Field>
        </div>
        <ToggleField
          label="Require review before autopilot creates articles"
          description={
            value.requireReview
              ? "Generated ideas must be approved before autopilot creates articles. Drafts also wait in Ready for review."
              : "Autopilot can approve its own ideas and generate article drafts automatically. Drafts still wait in Ready for review."
          }
          checked={value.requireReview}
          onChange={(requireReview) => onChange({ requireReview })}
        />
        <ToggleField
          label="Auto-regenerate failed drafts"
          description="When autopilot picks up a failed job, retry instead of skipping. (No effect today — autopilot ships in a later release.)"
          checked={value.regenerateOnFail}
          onChange={(regenerateOnFail) => onChange({ regenerateOnFail })}
        />
      </Section>

      <Section
        title="Backlog & spend"
        description="Keep an idea pool ready and put a per-blog cap on token spend."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Approved-idea backlog target"
            htmlFor="automation-backlog-threshold"
            hint="Autopilot tops the idea pool back up when approved-but-unconverted ideas drop below this."
          >
            <Input
              id="automation-backlog-threshold"
              type="number"
              min={0}
              max={1000}
              value={value.backlogThreshold}
              onChange={(e) =>
                onChange({ backlogThreshold: Number(e.target.value) || 0 })
              }
            />
          </Field>
          <Field
            label="Daily Synth-token budget"
            htmlFor="automation-daily-token-budget"
            hint="Autopilot won't spend more Synth tokens than this in a day. Leave blank for no per-blog cap."
          >
            <Input
              id="automation-daily-token-budget"
              type="number"
              min={0}
              max={1_000_000}
              value={value.dailyTokenBudget ?? ""}
              placeholder="No cap"
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  onChange({ dailyTokenBudget: null });
                  return;
                }
                const n = Number(raw);
                onChange({
                  dailyTokenBudget: Number.isFinite(n) && n >= 0 ? n : null,
                });
              }}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Auto publishing"
        description="Schedule windows and preferred days. Hidden until WordPress publishing is shipped."
      >
        <div className="flex items-center gap-2 text-sm text-muted">
          <Badge variant="brand">Coming soon</Badge>
          <span>
            Auto-publishing controls light up when the WordPress connection is
            live. Generation settings above stay in effect today.
          </span>
        </div>
      </Section>
    </>
  );
}

// ─── Publishing ─────────────────────────────────────────────────────────────

function PublishingTab({
  value,
  onChange,
  hasWordPressConnection,
}: {
  value: BlogSettings["publishing"];
  onChange: (p: Partial<BlogSettings["publishing"]>) => void;
  hasWordPressConnection: boolean;
}) {
  return (
    <>
      <Section
        title="WordPress draft defaults"
        description="Applied when you send or update a WordPress draft from SynthPress (including autopilot auto-send). Connect your site in the Connections tab. Live publishing stays manual from the article page."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Default author (WordPress login)"
            htmlFor="publishing-author"
            hint="WordPress user slug or display name. Leave blank to use the connected account."
          >
            <Input
              id="publishing-author"
              value={value.defaultAuthor}
              onChange={(e) => onChange({ defaultAuthor: e.target.value })}
              placeholder="e.g. editor"
            />
          </Field>
          <Field
            label="Default category"
            htmlFor="publishing-category"
            hint="Category name on your WordPress site. We match or create it when sending drafts."
          >
            <Input
              id="publishing-category"
              value={value.defaultCategory}
              onChange={(e) => onChange({ defaultCategory: e.target.value })}
              placeholder="e.g. blog"
            />
          </Field>
        </div>
        <Field
          label="Default tags"
          htmlFor="publishing-tags"
          hint="Comma-separated tag names. We match or create each tag when sending drafts."
        >
          <Input
            id="publishing-tags"
            value={value.defaultTags.join(", ")}
            onChange={(e) =>
              onChange({
                defaultTags: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="ai, tooling, productivity"
          />
        </Field>
        <ToggleField
          label="Upload featured image to WordPress"
          description="When on, the article's featured image is uploaded and set on the WordPress post. Section images in the body are unaffected."
          checked={value.uploadFeaturedImage}
          onChange={(uploadFeaturedImage) => onChange({ uploadFeaturedImage })}
        />
      </Section>

      <Section
        title="WordPress draft automation"
        description="Autopilot always sends WordPress drafts only — never live posts. Use Publish Live on the article page when you are ready to go live."
      >
        <ToggleField
          label="Automatically send autopilot articles to WordPress drafts"
          description={
            hasWordPressConnection
              ? "When enabled, autopilot-generated articles are sent to WordPress as drafts after generation. Live publishing remains manual."
              : "Connect WordPress before enabling automatic draft sending."
          }
          checked={value.autoSendToWordPressDraft}
          onChange={(autoSendToWordPressDraft) =>
            onChange({ autoSendToWordPressDraft })
          }
          disabled={!hasWordPressConnection}
        />
      </Section>
    </>
  );
}

// ─── Media ──────────────────────────────────────────────────────────────────

function MediaTab({
  value,
  onChange,
}: {
  value: BlogSettings["media"];
  onChange: (p: Partial<BlogSettings["media"]>) => void;
}) {
  const autoPickDisabled =
    !value.autoPickImages || value.imageProvider === "none";

  return (
    <Section
      title="Stock images (Pexels)"
      description="Automatically choose a featured image and section images from Pexels for AI-generated articles. You can replace images before publishing."
    >
      <ToggleField
        label="Automatically choose images for AI-generated articles"
        description="When enabled, SynthPress picks stock images from the provider below after each article is generated."
        checked={value.autoPickImages}
        onChange={(autoPickImages) => onChange({ autoPickImages })}
      />
      <Field label="Image provider" htmlFor="media-image-provider">
        <Select
          id="media-image-provider"
          value={value.imageProvider}
          onChange={(e) =>
            onChange({
              imageProvider: e.target
                .value as BlogSettings["media"]["imageProvider"],
            })
          }
          options={[
            { value: "pexels", label: "Pexels" },
            { value: "none", label: "None (manual picks only)" },
          ]}
        />
      </Field>
      <ToggleField
        label="Add images above article sections"
        description="When enabled, SynthPress picks section images for H2 sections. Featured images can still be picked automatically."
        checked={value.includeInlineImages}
        onChange={(includeInlineImages) => onChange({ includeInlineImages })}
        disabled={autoPickDisabled}
      />
      {autoPickDisabled ? (
        <p className="text-xs text-muted">
          Turn on automatic image picking and choose Pexels to configure section
          images.
        </p>
      ) : null}
    </Section>
  );
}

// ─── Advanced ───────────────────────────────────────────────────────────────

function AdvancedTab({
  value,
  onChange,
}: {
  value: BlogSettings["advanced"];
  onChange: (p: Partial<BlogSettings["advanced"]>) => void;
}) {
  return (
    <>
      <Section
        title="Custom prompts & templates"
        description="Power users only — these override the defaults the rest of the settings imply."
      >
        <Field label="Custom system prompt" htmlFor="advanced-system-prompt">
          <Textarea
            id="advanced-system-prompt"
            value={value.customSystemPrompt}
            onChange={(e) => onChange({ customSystemPrompt: e.target.value })}
            rows={4}
            className="font-mono text-xs"
          />
        </Field>
        <Field
          label="Custom outline template"
          htmlFor="advanced-outline-template"
        >
          <Textarea
            id="advanced-outline-template"
            value={value.customOutlineTemplate}
            onChange={(e) =>
              onChange({ customOutlineTemplate: e.target.value })
            }
            rows={4}
            className="font-mono text-xs"
          />
        </Field>
        <Field
          label="Custom article template"
          htmlFor="advanced-article-template"
        >
          <Textarea
            id="advanced-article-template"
            value={value.customArticleTemplate}
            onChange={(e) =>
              onChange({ customArticleTemplate: e.target.value })
            }
            rows={6}
            className="font-mono text-xs"
          />
        </Field>
      </Section>

      <Section
        title="Disclosures & links"
        description="Optional copy and link rules applied to every post."
      >
        <Field label="Default disclaimer" htmlFor="advanced-disclaimer">
          <Textarea
            id="advanced-disclaimer"
            value={value.defaultDisclaimer}
            onChange={(e) => onChange({ defaultDisclaimer: e.target.value })}
            rows={3}
          />
        </Field>
        <Field label="Affiliate disclosure" htmlFor="advanced-affiliate">
          <Textarea
            id="advanced-affiliate"
            value={value.affiliateDisclosure}
            onChange={(e) => onChange({ affiliateDisclosure: e.target.value })}
            rows={3}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Internal links to prioritize"
            htmlFor="advanced-internal-links"
            hint="One per line. The AI will weave these in when relevant."
          >
            <Textarea
              id="advanced-internal-links"
              value={value.internalLinksToPrioritize}
              onChange={(e) =>
                onChange({ internalLinksToPrioritize: e.target.value })
              }
              rows={4}
            />
          </Field>
          <Field
            label="Competitors to avoid linking to"
            htmlFor="advanced-competitors"
            hint="One domain per line."
          >
            <Textarea
              id="advanced-competitors"
              value={value.competitorsToAvoid}
              onChange={(e) => onChange({ competitorsToAvoid: e.target.value })}
              rows={4}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}
