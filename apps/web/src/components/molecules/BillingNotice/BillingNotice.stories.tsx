import type { Meta, StoryObj } from "@storybook/react";
import { BillingNotice } from "./BillingNotice";
import { Button } from "@/components/atoms/Button";

const meta = {
  title: "Molecules/BillingNotice",
  component: BillingNotice,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof BillingNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ScheduledToCancel: Story = {
  args: {
    variant: "warning",
    title: "Your Pro plan is set to cancel on June 5, 2026",
    description:
      "You'll keep full access until then. Resume anytime to continue your subscription.",
    action: <Button>Resume subscription</Button>,
  },
};

export const PaymentFailed: Story = {
  args: {
    variant: "danger",
    title: "Your last payment failed",
    description:
      "Update your payment method to keep your subscription active. Stripe will automatically retry over the next few days.",
    action: <Button>Update payment method</Button>,
  },
};

export const Unpaid: Story = {
  args: {
    variant: "danger",
    title: "Subscription is unpaid",
    description:
      "Your subscription is on hold until you update your payment method.",
    action: <Button>Update payment method</Button>,
  },
};

export const Resumed: Story = {
  args: {
    variant: "success",
    title: "Subscription resumed",
    description: "Your Pro plan will renew automatically on the next billing date.",
  },
};

export const Info: Story = {
  args: {
    variant: "info",
    title: "Tokens are loading",
    description: "Stripe is confirming your payment. This usually takes a few seconds.",
  },
};
