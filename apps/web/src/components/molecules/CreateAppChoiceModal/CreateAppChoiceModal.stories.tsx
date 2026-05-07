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

const noop = () => {};

export const ChooseStep: Story = {
  args: {
    open: true,
    onClose: noop,
    step: "choose",
    onChooseBlog: noop,
    onBack: noop,
    blogName: "",
    onBlogNameChange: noop,
    onCreateBlog: noop,
  },
};

export const NameStep: Story = {
  args: {
    open: true,
    onClose: noop,
    step: "name",
    onChooseBlog: noop,
    onBack: noop,
    blogName: "Main site",
    onBlogNameChange: noop,
    onCreateBlog: noop,
  },
};

export const NameStepPending: Story = {
  args: {
    open: true,
    onClose: noop,
    step: "name",
    onChooseBlog: noop,
    onBack: noop,
    blogName: "Main site",
    onBlogNameChange: noop,
    onCreateBlog: noop,
    pending: true,
  },
};

export const NameStepError: Story = {
  args: {
    open: true,
    onClose: noop,
    step: "name",
    onChooseBlog: noop,
    onBack: noop,
    blogName: "Main site",
    onBlogNameChange: noop,
    onCreateBlog: noop,
    errorMessage: "A blog with this name already exists in this project.",
  },
};
