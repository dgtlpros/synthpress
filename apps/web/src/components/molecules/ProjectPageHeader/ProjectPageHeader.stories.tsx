import type { Meta, StoryObj } from "@storybook/react";
import { ProjectPageHeader } from "./ProjectPageHeader";

const meta = {
  title: "Molecules/ProjectPageHeader",
  component: ProjectPageHeader,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ProjectPageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    projectName: "Marketing site",
    teamName: "DGTL PROS",
    descriptionPreview: "WordPress rollout and AI drafts for the main brand.",
    onOpenSettings: () => {},
  },
};

export const NoDescription: Story = {
  args: {
    projectName: "k",
    teamName: "DGTL PROS",
    descriptionPreview: null,
    onOpenSettings: () => {},
  },
};
