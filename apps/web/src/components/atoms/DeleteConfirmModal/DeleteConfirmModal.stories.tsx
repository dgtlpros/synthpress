import type { Meta, StoryObj } from "@storybook/react";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

const meta: Meta<typeof DeleteConfirmModal> = {
  title: "Atoms/DeleteConfirmModal",
  component: DeleteConfirmModal,
  parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof DeleteConfirmModal>;

export const DeleteTeam: Story = {
  args: {
    open: false,
    entityKind: "team",
    requiredPhrase: "Marketing",
    loading: false,
  },
};

export const DeleteProject: Story = {
  args: {
    open: false,
    entityKind: "project",
    requiredPhrase: "Website Redesign",
    loading: false,
  },
};

export const Loading: Story = {
  args: {
    open: false,
    entityKind: "blog app",
    requiredPhrase: "Tech Blog",
    loading: true,
  },
};
