import type { Meta, StoryObj } from "@storybook/react";
import { Modal } from "./Modal";

const meta = {
  title: "Atoms/Modal",
  component: Modal,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Project settings",
    description: "Update how this project appears to your team.",
    children: <p className="text-sm text-muted">Form fields go here.</p>,
    footer: (
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-[var(--sp-radius-lg)] border border-border px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-[var(--sp-radius-lg)] bg-gradient-accent px-3 py-1.5 text-sm text-white"
        >
          Save
        </button>
      </div>
    ),
  },
};
