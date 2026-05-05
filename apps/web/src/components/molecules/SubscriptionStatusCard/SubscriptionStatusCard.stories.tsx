import type { Meta, StoryObj } from "@storybook/react";
import { SubscriptionStatusCard } from "./SubscriptionStatusCard";
import { Button } from "@/components/atoms/Button";

const meta = {
  title: "Molecules/SubscriptionStatusCard",
  component: SubscriptionStatusCard,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof SubscriptionStatusCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Free: Story = {
  args: {
    planName: "Free",
    status: "free",
    actions: <Button>Upgrade</Button>,
  },
};

export const ActivePro: Story = {
  args: {
    planName: "Pro",
    planDescription: "For growing networks",
    status: "active",
    monthlyPriceCents: 7900,
    currentPeriodEnd: "2026-06-01T00:00:00Z",
    actions: <Button variant="secondary">Manage subscription</Button>,
  },
};

export const Trialing: Story = {
  args: {
    planName: "Pro",
    status: "trialing",
    monthlyPriceCents: 7900,
    currentPeriodEnd: "2026-05-15T00:00:00Z",
  },
};

export const CancelingAtPeriodEnd: Story = {
  args: {
    planName: "Pro",
    status: "active",
    monthlyPriceCents: 7900,
    currentPeriodEnd: "2026-06-01T00:00:00Z",
    cancelAtPeriodEnd: true,
    actions: <Button variant="secondary">Resume subscription</Button>,
  },
};

export const PastDue: Story = {
  args: {
    planName: "Pro",
    status: "past_due",
    monthlyPriceCents: 7900,
    currentPeriodEnd: "2026-06-01T00:00:00Z",
    actions: <Button>Update card</Button>,
  },
};
