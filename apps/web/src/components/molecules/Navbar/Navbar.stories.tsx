import type { Meta, StoryObj } from "@storybook/react";
import { Navbar } from "./Navbar";

const meta = {
  title: "Molecules/Navbar",
  component: Navbar,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof Navbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LoggedOut: Story = {
  args: { user: null },
};

export const LoggedIn: Story = {
  args: { user: { email: "user@example.com" } },
};
