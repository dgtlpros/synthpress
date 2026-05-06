import type { Meta, StoryObj } from "@storybook/react";
import { ProjectsListToolbar } from "./ProjectsListToolbar";

const meta = {
  title: "Molecules/ProjectsListToolbar",
  component: ProjectsListToolbar,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ProjectsListToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    searchQuery: "",
    onSearchChange: () => {},
    sortKey: "name-asc",
    onSortChange: () => {},
  },
};
