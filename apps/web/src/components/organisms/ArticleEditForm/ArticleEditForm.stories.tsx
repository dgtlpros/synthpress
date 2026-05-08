import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ArticleEditForm, type ArticleEditFormValue } from "./ArticleEditForm";

const meta = {
  title: "Organisms/ArticleEditForm",
  component: ArticleEditForm,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ArticleEditForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const initialValue: ArticleEditFormValue = {
  title: "How to launch a B2B blog in 30 days",
  slug: "how-to-launch-a-b2b-blog-in-30-days",
  excerpt: "A practical 30-day plan to ship your first ten posts.",
  metaDescription:
    "Step-by-step playbook for launching a B2B blog in 30 days, with weekly milestones.",
  targetKeyword: "launch a b2b blog",
  contentMarkdown: `# How to launch a B2B blog in 30 days

Launching a B2B blog is mostly about discipline. Here's the four-week plan we use with our clients.

## Week 1: positioning

Start by clarifying the audience.

## Week 2: research

Build the keyword + topic map.
`,
};

function Interactive(args: Parameters<typeof ArticleEditForm>[0]) {
  const [value, setValue] = useState<ArticleEditFormValue>(args.value);
  return (
    <ArticleEditForm
      {...args}
      value={value}
      onChange={(key, next) => setValue((prev) => ({ ...prev, [key]: next }))}
    />
  );
}

export const Default: Story = {
  args: {
    value: initialValue,
    onChange: () => {},
    onCancel: () => {},
    onSubmit: () => {},
  },
  render: (args) => <Interactive {...args} />,
};

export const Saving: Story = {
  args: {
    value: initialValue,
    onChange: () => {},
    onCancel: () => {},
    onSubmit: () => {},
    isSaving: true,
  },
};

export const WithError: Story = {
  args: {
    value: initialValue,
    onChange: () => {},
    onCancel: () => {},
    onSubmit: () => {},
    errorMessage: "Slug must be lowercase letters, numbers, and hyphens only.",
  },
};
