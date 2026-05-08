import type { Meta, StoryObj } from "@storybook/react";
import { PostsDashboard, type PostsDashboardPost } from "./PostsDashboard";

const meta = {
  title: "Organisms/PostsDashboard",
  component: PostsDashboard,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof PostsDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

const minutesAgo = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString();
const daysAhead = (n: number) =>
  new Date(Date.now() + n * 24 * 60 * 60_000).toISOString();

const posts: PostsDashboardPost[] = [
  {
    id: "p1",
    title: "The complete guide to AI blogging in 2026",
    status: "ready_for_review",
    excerpt:
      "Everything we learned shipping a thousand AI-generated posts in 2025: prompting, editing, and publishing.",
    targetKeyword: "ai blogging",
    authorPersona: null,
    wordCount: 1820,
    generatedByModel: "claude-sonnet-4-6",
    scheduledAt: null,
    publishedAt: null,
    createdAt: minutesAgo(180),
    updatedAt: minutesAgo(15),
    destinationLabel: null,
  },
  {
    id: "p2",
    title: "10 SEO tactics that still work",
    status: "scheduled",
    excerpt: null,
    targetKeyword: "seo 2026",
    authorPersona: "Editorial team",
    wordCount: 2140,
    generatedByModel: null,
    scheduledAt: daysAhead(2),
    publishedAt: null,
    createdAt: minutesAgo(60 * 24),
    updatedAt: minutesAgo(60),
    destinationLabel: "WordPress (example.com)",
  },
  {
    id: "p3",
    title: "Why content velocity matters more than perfection",
    status: "published",
    excerpt: "How fast iteration beats perfect drafts every time.",
    targetKeyword: "content velocity",
    authorPersona: "Editorial team",
    wordCount: 980,
    generatedByModel: null,
    scheduledAt: null,
    publishedAt: minutesAgo(60 * 30),
    createdAt: minutesAgo(60 * 48),
    updatedAt: minutesAgo(60 * 30),
    destinationLabel: "WordPress (example.com)",
  },
  {
    id: "p4",
    title: "Untitled draft",
    status: "generating",
    excerpt: null,
    targetKeyword: null,
    authorPersona: null,
    wordCount: null,
    generatedByModel: null,
    scheduledAt: null,
    publishedAt: null,
    createdAt: minutesAgo(2),
    updatedAt: minutesAgo(1),
    destinationLabel: null,
  },
  {
    id: "p5",
    title: "Affiliate roundup that failed mid-publish",
    status: "failed",
    excerpt: null,
    targetKeyword: "best ai writing tools",
    authorPersona: null,
    wordCount: 1500,
    generatedByModel: "claude-sonnet-4-6",
    scheduledAt: null,
    publishedAt: null,
    createdAt: minutesAgo(60 * 4),
    updatedAt: minutesAgo(60 * 2),
    destinationLabel: "WordPress (example.com)",
  },
];

export const Default: Story = {
  args: {
    posts,
    onCreatePost: () => {},
    ideasHref: "/teams/t1/projects/p1/blogs/b1/ideas",
    onPostClick: () => {},
  },
};

export const Empty: Story = {
  args: {
    posts: [],
    onCreatePost: () => {},
    ideasHref: "/teams/t1/projects/p1/blogs/b1/ideas",
  },
};

export const EmptyWithoutIdeasLink: Story = {
  args: {
    posts: [],
    onCreatePost: () => {},
  },
};

export const SingleStatus: Story = {
  args: {
    posts: posts.filter((p) => p.status === "published"),
    onCreatePost: () => {},
    ideasHref: "/teams/t1/projects/p1/blogs/b1/ideas",
  },
};
