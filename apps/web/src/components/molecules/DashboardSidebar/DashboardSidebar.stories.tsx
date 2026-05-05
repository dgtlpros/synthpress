import type { Meta, StoryObj } from "@storybook/react";
import { DashboardSidebar } from "./DashboardSidebar";

const meta = {
  title: "Molecules/DashboardSidebar",
  component: DashboardSidebar,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof DashboardSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { label: "Dashboard", href: "/dashboard", isActive: true },
  { label: "Projects", href: "/projects" },
  { label: "Articles", href: "/articles" },
  { label: "Account", href: "/account" },
  { label: "Billing", href: "/account/billing" },
];

export const Default: Story = {
  args: { navItems: items, email: "user@synthpress.app" },
  render: (args) => (
    <div className="h-screen">
      <DashboardSidebar {...args} />
    </div>
  ),
};

export const NoEmail: Story = {
  args: { navItems: items },
  render: (args) => (
    <div className="h-screen">
      <DashboardSidebar {...args} />
    </div>
  ),
};
