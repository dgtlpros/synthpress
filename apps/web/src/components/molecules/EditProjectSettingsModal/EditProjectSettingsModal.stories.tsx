import type { Meta, StoryObj } from "@storybook/react";
import { EditProjectSettingsModal } from "./EditProjectSettingsModal";

const meta = {
  title: "Molecules/EditProjectSettingsModal",
  component: EditProjectSettingsModal,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof EditProjectSettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    open: true,
    onClose: () => {},
    projectName: "Launch site",
    description: "Main marketing project.",
    onProjectNameChange: () => {},
    onDescriptionChange: () => {},
    footer: (
      <div className="flex gap-2">
        <button type="button" className="rounded-[var(--sp-radius-lg)] border border-border px-3 py-1.5 text-sm">
          Cancel
        </button>
        <button type="button" className="rounded-[var(--sp-radius-lg)] bg-gradient-accent px-3 py-1.5 text-sm text-white">
          Save
        </button>
      </div>
    ),
  },
};
