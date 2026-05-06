import type { Meta, StoryObj } from "@storybook/react";
import { PlanBadge } from "./PlanBadge";

const meta = {
  title: "Atoms/PlanBadge",
  component: PlanBadge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    status: {
      control: "select",
      options: [
        "active",
        "trialing",
        "canceling",
        "past_due",
        "incomplete",
        "canceled",
        "unpaid",
        "paused",
        "free",
      ],
    },
  },
} satisfies Meta<typeof PlanBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = { args: { planName: "Pro", status: "active" } };
export const Trialing: Story = {
  args: { planName: "Pro", status: "trialing" },
};
export const Canceling: Story = {
  args: { planName: "Pro", status: "canceling" },
};
export const PastDue: Story = { args: { planName: "Pro", status: "past_due" } };
export const Canceled: Story = {
  args: { planName: "Pro", status: "canceled" },
};
export const Free: Story = { args: { planName: "Free", status: "free" } };
