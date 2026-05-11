import type { Meta, StoryObj } from "@storybook/react";
import {
  AUTOPILOT_RUN_STATUSES,
  AutopilotRunStatusBadge,
} from "./AutopilotRunStatusBadge";

const meta = {
  title: "Atoms/AutopilotRunStatusBadge",
  component: AutopilotRunStatusBadge,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    status: {
      control: "select",
      options: AUTOPILOT_RUN_STATUSES as unknown as string[],
    },
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof AutopilotRunStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completed: Story = { args: { status: "completed" } };
export const Skipped: Story = { args: { status: "skipped" } };
export const Failed: Story = { args: { status: "failed" } };
export const Processing: Story = { args: { status: "processing" } };
export const Pending: Story = { args: { status: "pending" } };
export const Cancelled: Story = { args: { status: "cancelled" } };

export const AllStatuses: Story = {
  // `args` is required on `Story`; we ignore it inside `render`.
  args: { status: "completed" },
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {AUTOPILOT_RUN_STATUSES.map((status) => (
        <AutopilotRunStatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
