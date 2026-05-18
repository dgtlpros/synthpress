import type { Meta, StoryObj } from "@storybook/react";
import { ArticleDetail } from "./ArticleDetail";

const meta = {
  title: "Organisms/ArticleDetail",
  component: ArticleDetail,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ArticleDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseArticle = {
  id: "a1",
  title: "How to launch a B2B blog in 30 days",
  slug: "how-to-launch-a-b2b-blog-in-30-days",
  status: "ready_for_review" as const,
  excerpt: "A practical 30-day plan to ship your first ten posts.",
  metaDescription:
    "Step-by-step playbook for launching a B2B blog in 30 days, with weekly milestones.",
  targetKeyword: "launch a b2b blog",
  contentMarkdown: `# How to launch a B2B blog in 30 days

Launching a B2B blog is mostly about discipline. Here's the four-week plan.

## Week 1: positioning

Start by clarifying the audience.

## Week 2: research

Build the keyword + topic map.
`,
  wordCount: 1623,
  generatedByModel: "claude-sonnet-4-6",
  errorMessage: null,
  updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  wpPostId: null,
  wpPostUrl: null,
  featuredImageUrl: null,
  featuredImageAlt: null,
  wpFeaturedMediaId: null,
  featuredImageAttribution: null,
};

export const Default: Story = {
  args: { article: baseArticle, onEdit: () => {} },
};

export const WithoutEditButton: Story = {
  args: { article: baseArticle },
};

export const Failed: Story = {
  args: {
    article: {
      ...baseArticle,
      status: "failed",
      contentMarkdown: null,
      errorMessage: "Anthropic API timed out after 60 seconds.",
    },
    onEdit: () => {},
  },
};

export const Generating: Story = {
  args: {
    article: {
      ...baseArticle,
      status: "generating",
      contentMarkdown: null,
    },
  },
};

export const WithFeaturedImage: Story = {
  args: {
    article: {
      ...baseArticle,
      featuredImageUrl:
        "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=1200",
      featuredImageAlt: "A laptop on a desk with a warm coffee mug.",
      wpFeaturedMediaId: 421,
    },
    onEdit: () => {},
  },
};

export const WithFeaturedImagePendingUpload: Story = {
  args: {
    article: {
      ...baseArticle,
      featuredImageUrl:
        "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=1200",
      featuredImageAlt: "A laptop on a desk with a warm coffee mug.",
      wpFeaturedMediaId: null,
    },
    onEdit: () => {},
  },
};

export const WithUnsplashAttribution: Story = {
  args: {
    article: {
      ...baseArticle,
      featuredImageUrl:
        "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=1200",
      featuredImageAlt: "A laptop on a desk with a warm coffee mug.",
      wpFeaturedMediaId: 421,
      featuredImageAttribution: {
        provider: "unsplash",
        photographerName: "Annie Spratt",
        photographerProfileUrl: "https://unsplash.com/@anniespratt",
        photoUrl: "https://unsplash.com/photos/abc",
      },
    },
    onEdit: () => {},
  },
};

export const WithSectionImages: Story = {
  args: {
    article: {
      ...baseArticle,
      sectionImagesByKey: {
        "week-1-positioning": {
          imageUrl:
            "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=1200",
          altText: "A team whiteboarding positioning",
          attribution: {
            provider: "unsplash",
            photographerName: "Annie Spratt",
            photographerProfileUrl: "https://unsplash.com/@anniespratt",
            photoUrl: "https://unsplash.com/photos/abc",
          },
        },
        "week-2-research": {
          imageUrl:
            "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1200",
          altText: "Open notebook with handwritten keyword research",
          attribution: {
            provider: "unsplash",
            photographerName: "Patrick Perkins",
            photographerProfileUrl: "https://unsplash.com/@patrickperkins",
            photoUrl: "https://unsplash.com/photos/def",
          },
        },
      },
    },
    onEdit: () => {},
  },
};
