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
  featuredImageUrl: "",
  featuredImageAlt: "",
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

export const WithSectionImages: Story = {
  args: {
    value: initialValue,
    onChange: () => {},
    onCancel: () => {},
    onSubmit: () => {},
    sectionImages: {
      "week-1-positioning": {
        imageUrl:
          "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=1080",
        altText: "A team whiteboarding positioning",
      },
    },
    onPickSectionImage: () => {},
    onSectionImageAltChange: () => {},
    onClearSectionImage: () => {},
  },
};

export const SectionImagesEmptyState: Story = {
  args: {
    value: {
      ...initialValue,
      // No H2 sections in the body → editor shows the empty-state
      // copy under the Section Images card.
      contentMarkdown: "# Title\n\nA single paragraph, no H2 sections.\n",
    },
    onChange: () => {},
    onCancel: () => {},
    onSubmit: () => {},
    sectionImages: {},
    onPickSectionImage: () => {},
    onSectionImageAltChange: () => {},
    onClearSectionImage: () => {},
  },
};
