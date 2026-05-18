import type { Meta, StoryObj } from "@storybook/react";
import { MarkdownPreview } from "./MarkdownPreview";

const meta = {
  title: "Atoms/MarkdownPreview",
  component: MarkdownPreview,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof MarkdownPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

const sample = `# Why durable execution matters for AI

Most AI infrastructure today runs on best-effort retries. **Durable execution** flips that
on its head: each step in your workflow is checkpointed so retries are deterministic.

## What you'll learn

- The difference between best-effort and durable retries
- How to model an AI pipeline as a workflow
- When durable execution is overkill

> "Durable execution is the most important infra primitive of the next decade."
> — _A platform engineer, somewhere_

### Quick comparison

| Approach            | Retries        | Observability |
| ------------------- | -------------- | ------------- |
| Plain Vercel route  | Best-effort    | Basic logs    |
| Vercel Workflow     | Durable        | Step-level    |

\`\`\`ts
"use workflow";
export async function generateArticle(blogId: string) {
  const idea = await pickIdea(blogId);
  const draft = await writeDraft(idea);
  return saveDraft(draft);
}
\`\`\`

Read more on [Vercel's blog](https://vercel.com/blog).
`;

export const Default: Story = { args: { markdown: sample } };

export const Empty: Story = { args: { markdown: "" } };

export const ShortParagraph: Story = {
  args: { markdown: "Just a short paragraph of body copy." },
};

const sectionBody = `# How to choose a video doorbell

A friendly intro paragraph that doesn't get its own image.

## What to look for

The most important spec is field-of-view; resolution comes second.

## Top picks under $200

Three solid options that share the same chip and 1080p sensor.
`;

export const WithSectionImages: Story = {
  args: {
    markdown: sectionBody,
    sectionImagesByKey: {
      "what-to-look-for": {
        imageUrl:
          "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=1080",
        altText: "A modern doorbell mounted by a front door",
        attribution: {
          provider: "unsplash",
          photographerName: "Annie Spratt",
          photographerProfileUrl: "https://unsplash.com/@anniespratt",
          photoUrl: "https://unsplash.com/photos/1",
        },
      },
      "top-picks-under-200": {
        imageUrl:
          "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1080",
        altText: "A row of small security cameras on a shelf",
        attribution: {
          provider: "unsplash",
          photographerName: "Patrick Perkins",
          photographerProfileUrl: "https://unsplash.com/@patrickperkins",
          photoUrl: "https://unsplash.com/photos/2",
        },
      },
    },
  },
};
