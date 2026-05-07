import type { Meta, StoryObj } from "@storybook/react";
import { WordPressConnectionForm } from "./WordPressConnectionForm";

const meta = {
  title: "Molecules/WordPressConnectionForm",
  component: WordPressConnectionForm,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof WordPressConnectionForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotConnected: Story = {
  args: {
    initialUrl: null,
    initialUsername: null,
    hasStoredPassword: false,
    onSubmit: () => {},
  },
};

export const Connected: Story = {
  args: {
    initialUrl: "https://example.com",
    initialUsername: "alice",
    hasStoredPassword: true,
    onSubmit: () => {},
    onDisconnect: () => {},
  },
};

export const WithError: Story = {
  args: {
    initialUrl: "https://example.com",
    initialUsername: "alice",
    hasStoredPassword: true,
    onSubmit: () => {},
    onDisconnect: () => {},
    error: "Authentication failed: HTTP 403.",
  },
};
