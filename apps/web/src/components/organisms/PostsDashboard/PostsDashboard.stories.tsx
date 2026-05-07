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
    status: "draft",
    targetKeyword: "ai blogging",
    authorPersona: "Editorial team",
    wordCount: 1820,
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
    targetKeyword: "seo 2026",
    authorPersona: "Editorial team",
    wordCount: 2140,
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
    targetKeyword: "content velocity",
    authorPersona: "Editorial team",
    wordCount: 980,
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
    targetKeyword: null,
    authorPersona: null,
    wordCount: null,
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
    targetKeyword: "best ai writing tools",
    authorPersona: null,
    wordCount: 1500,
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
    onGeneratePost: () => {},
    onPostClick: () => {},
  },
};

export const Empty: Story = {
  args: {
    posts: [],
    onCreatePost: () => {},
    onGeneratePost: () => {},
  },
};

export const SingleStatus: Story = {
  args: {
    posts: posts.filter((p) => p.status === "published"),
    onCreatePost: () => {},
    onGeneratePost: () => {},
  },
};
