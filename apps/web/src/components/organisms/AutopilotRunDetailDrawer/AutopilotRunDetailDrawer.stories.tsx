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
