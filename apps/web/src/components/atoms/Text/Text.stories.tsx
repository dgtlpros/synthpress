import type { Meta, StoryObj } from "@storybook/react";
import { Text } from "./Text";

const meta = {
  title: "Atoms/Text",
  component: Text,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "body",
        "body-sm",
        "caption",
        "overline",
      ],
    },
    color: {
      control: "select",
      options: [
        "default",
        "muted",
        "brand",
        "accent",
        "success",
        "warning",
        "error",
      ],
    },
  },
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Text variant="h1">Heading 1 — 4xl bold</Text>
      <Text variant="h2">Heading 2 — 3xl semibold</Text>
      <Text variant="h3">Heading 3 — 2xl semibold</Text>
      <Text variant="h4">Heading 4 — xl semibold</Text>
      <Text variant="h5">Heading 5 — lg medium</Text>
      <Text variant="h6">Heading 6 — base medium</Text>
      <Text variant="body">
        Body — base regular. The quick brown fox jumps over the lazy dog.
      </Text>
      <Text variant="body-sm">
        Body Small — sm regular. The quick brown fox jumps over the lazy dog.
      </Text>
      <Text variant="caption">Caption — xs regular</Text>
      <Text variant="overline">Overline — xs semibold uppercase</Text>
    </div>
  ),
};

export const Colors: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Text variant="h4" color="default">
        Default foreground
      </Text>
      <Text variant="h4" color="muted">
        Muted text
      </Text>
      <Text variant="h4" color="brand">
        Brand gradient text
      </Text>
      <Text variant="h4" color="accent">
        Accent gradient text
      </Text>
      <Text variant="h4" color="success">
        Success text
      </Text>
      <Text variant="h4" color="warning">
        Warning text
      </Text>
      <Text variant="h4" color="error">
        Error text
      </Text>
    </div>
  ),
};

export const Heading1: Story = {
  args: { variant: "h1", children: "SynthPress Dashboard" },
};
export const BodyText: Story = {
  args: {
    variant: "body",
    children: "Manage all 20 WordPress sites from one place.",
  },
};
export const BrandGradient: Story = {
  args: { variant: "h2", color: "brand", children: "AI-Powered Publishing" },
};
