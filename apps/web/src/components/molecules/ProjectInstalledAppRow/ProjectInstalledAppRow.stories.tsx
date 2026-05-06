import type { Meta, StoryObj } from "@storybook/react";
import { ProjectInstalledAppRow } from "./ProjectInstalledAppRow";

const meta = {
  title: "Molecules/ProjectInstalledAppRow",
  component: ProjectInstalledAppRow,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ProjectInstalledAppRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BlogActive: Story = {
  args: {
    href: "#",
    appKindLabel: "Blog",
    title: "Corporate WordPress",
    subtitle: "https://news.example.com",
    isActive: true,
    meta: "Up to 3 articles / day",
  },
};

export const BlogPaused: Story = {
  args: {
    href: "#",
    appKindLabel: "Blog",
    title: "Legacy site",
    subtitle: "https://old.example.com",
    isActive: false,
  },
};
