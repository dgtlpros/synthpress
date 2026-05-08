import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@/components/atoms/Button";
import { BlogHeader } from "./BlogHeader";

const meta = {
  title: "Molecules/BlogHeader",
  component: BlogHeader,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    automationMode: { control: "select", options: ["manual", "autopilot"] },
  },
} satisfies Meta<typeof BlogHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

const actions = (
  <>
    <Button variant="secondary" size="sm">
      Generate
    </Button>
    <Button size="sm">Create post</Button>
  </>
);

export const Default: Story = {
  args: {
    name: "Indie Hacker Stories",
    description:
      "Stories about building bootstrapped products. Long-form, evergreen, conversational.",
    actions,
  },
};

export const Manual: Story = {
  args: {
    name: "AI Toolkit Reviews",
    description: "Hand-picked reviews of AI productivity tools.",
    automationMode: "manual",
    actions,
  },
};

export const Autopilot: Story = {
  args: {
    name: "Daily AI News",
    description: "Daily roundup of the latest AI announcements.",
    automationMode: "autopilot",
    automationEnabled: true,
    actions,
  },
};

export const AutopilotPaused: Story = {
  args: {
    name: "Daily AI News",
    description: "Daily roundup of the latest AI announcements.",
    automationMode: "autopilot",
    automationEnabled: false,
    actions,
  },
};
