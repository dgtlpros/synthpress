import type { Meta, StoryObj } from "@storybook/react";
import { AppCard } from "./AppCard";
import { Badge } from "@/components/atoms/Badge";

const meta = {
  title: "Molecules/AppCard",
  component: AppCard,
  tags: ["autodocs"],
} satisfies Meta<typeof AppCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linked: Story = {
  args: {
    title: "Blog",
    description: "Connect WordPress and automate drafts.",
    href: "#",
    icon: "📝",
    badge: <Badge variant="default">2</Badge>,
  },
};

export const Disabled: Story = {
  args: {
    title: "Newsletter",
    description: "Coming soon.",
    disabled: true,
    icon: "✉️",
  },
};
