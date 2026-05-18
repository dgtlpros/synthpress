import type { Meta, StoryObj } from "@storybook/react";
import { AutopilotRunDetailDrawer } from "./AutopilotRunDetailDrawer";
import type { BlogAutopilotRunDetail } from "@/services/blog-autopilot-run-service";

const NOW = new Date("2026-05-11T08:30:00Z").toISOString();

const meta = {
  title: "Organisms/AutopilotRunDetailDrawer",
  component: AutopilotRunDetailDrawer,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof AutopilotRunDetailDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseRun: BlogAutopilotRunDetail["run"] = {
  id: "run-stub-1",
  team_id: "t1",
  project_id: "p1",
  blog_id: "b1",
  triggered_by_user_id: null,
  trigger_source: "cron",
  status: "completed",
  started_at: NOW,
  completed_at: NOW,
  scheduled_for: null,
  current_step: "completed",
  error_message: null,
  input: { triggerSource: "cron" },
  output: {
    reason: "ok",
    ideasAutoApproved: 5,
    requireReview: false,
    spawnedArticleJobIds: ["job-1", "job-2"],
    budget: {
      tokenBalance: 950,
      tokensSpentToday: 50,
      tokensRemainingFromBudget: 200,
    },
    daily: { cap: 5, articlesStartedToday: 2 },
    backlog: { approvedIdeasAvailable: 5 },
  },
  ideas_generated: 5,
  articles_started: 2,
  articles_completed: 1,
  articles_failed: 0,
  tokens_spent: 11,
  tokens_refunded: 0,
  wp_drafts_expected: 0,
  wp_drafts_created: 0,
  wp_drafts_already_sent: 0,
  wp_drafts_skipped: 0,
  wp_drafts_failed: 0,
  created_at: NOW,
  updated_at: NOW,
};

export const Loaded: Story = {
  args: {
    open: true,
    onClose: () => {},
    isLoading: false,
    error: null,
    postsHref: "/teams/t1/projects/p1/blogs/b1/posts",
    detail: {
      run: baseRun,
      jobs: [
        {
          id: "job-1",
          type: "generate_article",
          status: "completed",
          currentStep: "completed",
          errorMessage: null,
          input: { autopilotRunId: "run-stub-1" },
          output: { model: "claude-sonnet-4.5" },
          articleId: "art-1",
          articleIdeaId: "idea-1",
          createdAt: NOW,
          startedAt: NOW,
          completedAt: NOW,
        },
        {
          id: "job-2",
          type: "generate_article",
          status: "failed",
          currentStep: "writing_article",
          errorMessage: "Anthropic returned 529 (overloaded).",
          input: { autopilotRunId: "run-stub-1" },
          output: { refunded: true },
          articleId: "art-2",
          articleIdeaId: "idea-2",
          createdAt: NOW,
          startedAt: NOW,
          completedAt: NOW,
        },
      ],
      articles: [
        {
          id: "art-1",
          title: "Why your indie SaaS needs a content engine",
          slug: "indie-saas-content-engine",
          status: "ready_for_review",
          wordCount: 1280,
          targetKeyword: "indie content",
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "art-2",
          title: "(Failed) The 5 metrics that matter most",
          slug: "five-metrics",
          status: "failed",
          wordCount: null,
          targetKeyword: "metrics",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      ideas: [
        {
          id: "idea-1",
          title: "Why your indie SaaS needs a content engine",
          status: "converted_to_article",
          targetKeyword: "indie content",
          executiveSummary: null,
          createdAt: NOW,
        },
        {
          id: "idea-2",
          title: "(Approved) The 5 metrics that matter most",
          status: "approved",
          targetKeyword: "metrics",
          executiveSummary: null,
          createdAt: NOW,
        },
      ],
    },
  },
};

export const Loading: Story = {
  args: {
    open: true,
    onClose: () => {},
    isLoading: true,
    error: null,
    detail: null,
  },
};

export const Errored: Story = {
  args: {
    open: true,
    onClose: () => {},
    isLoading: false,
    error: "Run not found.",
    detail: null,
  },
};

export const PausedAfterFailures: Story = {
  args: {
    ...Loaded.args,
    automationSettingsHref: "#automation",
    detail: {
      ...Loaded.args!.detail!,
      run: {
        ...baseRun,
        status: "failed",
        error_message: "Idea generation failed: Anthropic returned 529.",
        output: {
          ...(baseRun.output as Record<string, unknown>),
          autopilotPaused: true,
          pauseReason: "failure_rate",
        },
      },
    },
  },
};

export const WithImageWarnings: Story = {
  args: {
    ...Loaded.args,
    detail: {
      ...Loaded.args!.detail!,
      jobs: Loaded.args!.detail!.jobs.map((job, i) =>
        i === 0
          ? {
              ...job,
              output: {
                ...(job.output as Record<string, unknown>),
                imageSummary: {
                  providerId: "unsplash",
                  featuredSelected: true,
                  sectionsFound: 4,
                  sectionImagesSelected: 2,
                  warnings: [
                    'Skipped section "Pricing": no results for "Pricing launch b2b blog" after 3 attempts.',
                    'Skipped section "FAQ": provider search failed (rate_limited).',
                  ],
                },
              },
            }
          : job,
      ),
    },
  },
};

export const WithWordPressDraftSent: Story = {
  args: {
    ...Loaded.args,
    detail: {
      ...Loaded.args!.detail!,
      jobs: Loaded.args!.detail!.jobs.map((job, i) =>
        i === 0
          ? {
              ...job,
              output: {
                ...(job.output as Record<string, unknown>),
                wpPublish: {
                  attempted: true,
                  status: "draft_created",
                  wpPostId: 4231,
                  wpPostUrl: "https://example.com/?p=4231",
                },
              },
            }
          : job,
      ),
    },
  },
};

export const WithWordPressDraftFailed: Story = {
  args: {
    ...Loaded.args,
    detail: {
      ...Loaded.args!.detail!,
      jobs: Loaded.args!.detail!.jobs.map((job, i) =>
        i === 0
          ? {
              ...job,
              output: {
                ...(job.output as Record<string, unknown>),
                wpPublish: {
                  attempted: true,
                  status: "failed",
                  warning:
                    "WordPress rejected the request. Check the connection and try again.",
                },
              },
            }
          : job,
      ),
    },
  },
};

/**
 * Run-level WordPress draft summary populated by
 * `syncAutopilotRunWordPressDraftCounters`. Happy path —
 * everything autopilot tried landed in WordPress.
 */
export const WithWordPressDraftSummary: Story = {
  args: {
    ...Loaded.args,
    detail: {
      ...Loaded.args!.detail!,
      run: {
        ...baseRun,
        wp_drafts_expected: 5,
        wp_drafts_created: 5,
        wp_drafts_already_sent: 0,
        wp_drafts_skipped: 0,
        wp_drafts_failed: 0,
      },
    },
  },
};

/**
 * Mixed-outcome run — some drafts created, one already sent on a
 * prior tick, one skipped because WordPress isn't connected, one
 * failure. Shows BOTH the failure alert and the skipped warning.
 */
export const WithWordPressDraftMixedOutcomes: Story = {
  args: {
    ...Loaded.args,
    detail: {
      ...Loaded.args!.detail!,
      run: {
        ...baseRun,
        wp_drafts_expected: 4,
        wp_drafts_created: 1,
        wp_drafts_already_sent: 1,
        wp_drafts_skipped: 1,
        wp_drafts_failed: 1,
      },
    },
  },
};
