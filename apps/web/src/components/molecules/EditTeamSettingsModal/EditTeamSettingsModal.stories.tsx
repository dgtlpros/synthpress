import type { Meta, StoryObj } from "@storybook/react";
import { EditTeamSettingsModal } from "./EditTeamSettingsModal";

const meta: Meta<typeof EditTeamSettingsModal> = {
  title: "Molecules/EditTeamSettingsModal",
  component: EditTeamSettingsModal,
  parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof EditTeamSettingsModal>;

export const Default: Story = {
  args: {
    open: false,
    teamName: "Marketing",
    errorMessage: null,
    pending: false,
    footer: null,
  },
};

export const WithError: Story = {
  args: {
    open: false,
    teamName: "",
    errorMessage: "Team name is required.",
    pending: false,
    footer: null,
  },
};
