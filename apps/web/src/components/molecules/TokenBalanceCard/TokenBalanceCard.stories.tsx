import type { Meta, StoryObj } from "@storybook/react";
import { TokenBalanceCard } from "./TokenBalanceCard";
import { Button } from "@/components/atoms/Button";

const meta = {
  title: "Molecules/TokenBalanceCard",
  component: TokenBalanceCard,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof TokenBalanceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  args: {
    balance: 5400,
    monthlyAllowance: 5000,
    actions: <Button variant="secondary">Buy more tokens</Button>,
  },
};

export const FreeUserHealthy: Story = {
  args: {
    balance: 100,
    actions: <Button>Subscribe</Button>,
  },
};

export const LowBalance: Story = {
  args: {
    balance: 25,
    monthlyAllowance: 5000,
    actions: <Button>Buy more tokens</Button>,
  },
};

export const OutOfTokens: Story = {
  args: {
    balance: 0,
    actions: <Button>Buy a token pack</Button>,
  },
};
