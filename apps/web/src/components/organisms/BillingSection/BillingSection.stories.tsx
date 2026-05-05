import type { Meta, StoryObj } from "@storybook/react";
import { BillingSection } from "./BillingSection";
import { Button } from "@/components/atoms/Button";

const meta = {
  title: "Organisms/BillingSection",
  component: BillingSection,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof BillingSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const samplePacks = [
  {
    key: "pack_500",
    name: "500 synth tokens",
    description: "Quick top-up for occasional bursts",
    tokens: 500,
    priceCents: 1900,
    ctaHref: "/checkout?pack=pack_500",
  },
  {
    key: "pack_2000",
    name: "2,000 synth tokens",
    description: "Best value for the average month",
    tokens: 2000,
    priceCents: 5900,
    ctaHref: "/checkout?pack=pack_2000",
  },
  {
    key: "pack_10000",
    name: "10,000 synth tokens",
    description: "Bulk pack for heavy production months",
    tokens: 10000,
    priceCents: 24900,
    ctaHref: "/checkout?pack=pack_10000",
  },
];

const sampleTransactions = [
  {
    id: "1",
    amount: 5000,
    type: "subscription_grant",
    description: "Pro plan — initial grant",
    created_at: "2026-05-01T00:00:00Z",
  },
  {
    id: "2",
    amount: 100,
    type: "signup_grant",
    description: "Welcome bonus",
    created_at: "2026-04-21T00:00:00Z",
  },
];

export const Free: Story = {
  args: {
    plan: null,
    subscription: null,
    balance: 100,
    transactions: sampleTransactions.slice(1),
    topUpPacks: samplePacks,
    subscriptionActions: <Button>Subscribe</Button>,
  },
};

export const ActivePro: Story = {
  args: {
    plan: {
      name: "Pro",
      description: "For growing networks",
      monthlyPriceCents: 7900,
      monthlyTokens: 5000,
    },
    subscription: {
      status: "active",
      currentPeriodEnd: "2026-06-01T00:00:00Z",
      cancelAtPeriodEnd: false,
    },
    balance: 5100,
    transactions: sampleTransactions,
    topUpPacks: samplePacks,
    subscriptionActions: <Button variant="secondary">Manage subscription</Button>,
  },
};

export const PastDue: Story = {
  args: {
    plan: {
      name: "Pro",
      description: "For growing networks",
      monthlyPriceCents: 7900,
      monthlyTokens: 5000,
    },
    subscription: {
      status: "past_due",
      currentPeriodEnd: "2026-06-01T00:00:00Z",
    },
    balance: 5100,
    transactions: sampleTransactions,
    topUpPacks: samplePacks,
    subscriptionActions: <Button>Update card</Button>,
  },
};
