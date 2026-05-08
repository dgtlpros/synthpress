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
