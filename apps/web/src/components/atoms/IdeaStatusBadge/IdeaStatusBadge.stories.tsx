import type { Meta, StoryObj } from "@storybook/react";
import { IDEA_STATUSES, IdeaStatusBadge } from "./IdeaStatusBadge";

const meta = {
  title: "Atoms/IdeaStatusBadge",
  component: IdeaStatusBadge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    status: { control: "select", options: IDEA_STATUSES },
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof IdeaStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Generated: Story = { args: { status: "generated" } };
export const Approved: Story = { args: { status: "approved" } };
export const Rejected: Story = { args: { status: "rejected" } };
export const Converted: Story = { args: { status: "converted_to_article" } };

export const AllStatuses: Story = {
  args: { status: "generated" },
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {IDEA_STATUSES.map((s) => (
        <IdeaStatusBadge key={s} status={s} />
      ))}
    </div>
  ),
};
