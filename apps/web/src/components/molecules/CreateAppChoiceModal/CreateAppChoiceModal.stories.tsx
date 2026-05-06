import type { Meta, StoryObj } from "@storybook/react";
import { CreateAppChoiceModal } from "./CreateAppChoiceModal";

const meta = {
  title: "Molecules/CreateAppChoiceModal",
  component: CreateAppChoiceModal,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof CreateAppChoiceModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    open: true,
    onClose: () => {},
    blogSetupHref: "#",
  },
};
