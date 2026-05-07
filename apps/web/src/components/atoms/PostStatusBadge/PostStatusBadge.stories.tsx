import type { Meta, StoryObj } from "@storybook/react";
import { POST_STATUSES, PostStatusBadge } from "./PostStatusBadge";

const meta = {
  title: "Atoms/PostStatusBadge",
  component: PostStatusBadge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    status: { control: "select", options: POST_STATUSES },
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof PostStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = { args: { status: "draft" } };
export const Generating: Story = { args: { status: "generating" } };
export const ReadyForReview: Story = { args: { status: "ready" } };
export const Scheduled: Story = { args: { status: "scheduled" } };
export const Publishing: Story = { args: { status: "publishing" } };
export const Published: Story = { args: { status: "published" } };
export const Failed: Story = { args: { status: "failed" } };
export const Archived: Story = { args: { status: "archived" } };

export const AllStatuses: Story = {
  args: { status: "draft" },
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {POST_STATUSES.map((s) => (
        <PostStatusBadge key={s} status={s} />
      ))}
    </div>
  ),
};
