import type { Meta, StoryObj } from "@storybook/react";
import { ProjectInstalledAppList } from "./ProjectInstalledAppList";

const meta = {
  title: "Molecules/ProjectInstalledAppList",
  component: ProjectInstalledAppList,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ProjectInstalledAppList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithBlogs: Story = {
  args: {
    items: [
      {
        id: "b1",
        href: "#",
        appKindLabel: "Blog",
        title: "Main WordPress",
        subtitle: "https://corp.example.com",
        isActive: true,
        meta: "Up to 2 articles / day",
      },
      {
        id: "b2",
        href: "#",
        appKindLabel: "Blog",
        title: "Newsroom",
        subtitle: "https://news.example.com",
        isActive: false,
      },
    ],
  },
};

export const Empty: Story = {
  args: { items: [] },
};
