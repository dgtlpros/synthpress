import type { Meta, StoryObj } from "@storybook/react";
import { Link } from "./Link";

const meta = {
  title: "Atoms/Link",
  component: Link,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Link>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "Learn more", href: "#" } };
export const Muted: Story = {
  args: { children: "Privacy Policy", href: "#", variant: "muted" },
};
export const Nav: Story = {
  args: { children: "Features", href: "#features", variant: "nav" },
};
