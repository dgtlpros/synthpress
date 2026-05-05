import type { Meta, StoryObj } from "@storybook/react";
import { CheckoutSuccessHero } from "./CheckoutSuccessHero";

const meta = {
  title: "Molecules/CheckoutSuccessHero",
  component: CheckoutSuccessHero,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof CheckoutSuccessHero>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SubscriptionSuccess: Story = {
  args: {
    variant: "success",
    eyebrow: "Payment successful",
    title: "Welcome to Pro",
    description:
      "Your subscription is active and 5,000 synth tokens just landed in your account.",
  },
};

export const TopUpSuccess: Story = {
  args: {
    variant: "success",
    eyebrow: "Top-up complete",
    title: "Tokens added to your account",
    description:
      "2,000 synth tokens were just added. They roll over and never expire.",
  },
};

export const Pending: Story = {
  args: {
    variant: "pending",
    eyebrow: "Hang tight",
    title: "Finishing your checkout",
    description:
      "Stripe is confirming your payment. This usually only takes a few seconds.",
  },
};

export const Error: Story = {
  args: {
    variant: "error",
    eyebrow: "Checkout expired",
    title: "Let's try that again",
    description:
      "This checkout session has expired. Start a new one from the pricing page.",
  },
};
