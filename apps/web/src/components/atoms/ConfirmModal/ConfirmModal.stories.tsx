import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ConfirmModal } from "./ConfirmModal";

const noop = () => {};

const meta = {
  title: "Atoms/ConfirmModal",
  component: ConfirmModal,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    onConfirm: noop,
    onCancel: noop,
  },
  argTypes: {
    variant: { control: "select", options: ["primary", "danger"] },
  },
} satisfies Meta<typeof ConfirmModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    open: true,
    title: "Confirm Action",
    message: "Are you sure you want to proceed with this action?",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    variant: "primary",
  },
};

export const Danger: Story = {
  args: {
    open: true,
    title: "Sign Out",
    message: "Are you sure you want to sign out of your account?",
    confirmLabel: "Sign Out",
    cancelLabel: "Cancel",
    variant: "danger",
  },
};

export const Loading: Story = {
  args: {
    open: true,
    title: "Deleting Project",
    message: "Are you sure you want to delete this project? This cannot be undone.",
    confirmLabel: "Delete",
    variant: "danger",
    loading: true,
  },
};

export const Interactive: Story = {
  args: {
    open: false,
    title: "Confirm Action",
    message: "This is an interactive demo of the confirm modal.",
  },
  render: (args) => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="rounded-[var(--sp-radius-lg)] bg-gradient-accent px-4 py-2 text-sm font-medium text-white"
        >
          Open Modal
        </button>
        <ConfirmModal
          {...args}
          open={open}
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  },
};
