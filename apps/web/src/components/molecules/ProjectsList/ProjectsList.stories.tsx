import type { Meta, StoryObj } from "@storybook/react";
import { ProjectsList } from "./ProjectsList";

const meta = {
  title: "Molecules/ProjectsList",
  component: ProjectsList,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ProjectsList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    teamId: "team-1",
    projects: [
      { id: "a", name: "Marketing" },
      { id: "b", name: "Product blog" },
    ],
  },
};
