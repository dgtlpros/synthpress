import type { Meta, StoryObj } from "@storybook/react";
import { CheckoutEmbed } from "./CheckoutEmbed";

const meta = {
  title: "Organisms/CheckoutEmbed",
  component: CheckoutEmbed,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Wraps Stripe's Embedded Checkout drop-in. Storybook cannot mount the real Stripe iframe without API keys, so this story shows the wrapper outline.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CheckoutEmbed>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { clientSecret: "cs_test_placeholder" },
};
