import type { Meta, StoryObj } from "@storybook/react";
import { BlogSubNav } from "./BlogSubNav";

const meta = {
  title: "Molecules/BlogSubNav",
  component: BlogSubNav,
  parameters: {
    layout: "padded",
    nextjs: {
      navigation: { pathname: "/teams/t/p/p/blogs/b" },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof BlogSubNav>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { segment: "", label: "Posts", badge: 12 },
  { segment: "queue", label: "Queue", badge: 3 },
  { segment: "calendar", label: "Calendar", comingSoon: true },
  { segment: "settings", label: "Settings" },
  { segment: "connections", label: "Connections" },
  { segment: "analytics", label: "Analytics", comingSoon: true },
];

export const PostsActive: Story = {
  args: { basePath: "/teams/t/p/p/blogs/b", items },
};

export const SettingsActive: Story = {
  args: { basePath: "/teams/t/p/p/blogs/b", items },
  parameters: {
    nextjs: {
      navigation: { pathname: "/teams/t/p/p/blogs/b/settings" },
    },
  },
};
