import type { Meta, StoryObj } from "@storybook/react";
import { LandingLayout } from "./LandingLayout";

const meta = {
  title: "Templates/LandingLayout",
  component: LandingLayout,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof LandingLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <h1 className="text-3xl font-bold text-foreground">Page Content</h1>
        <p className="text-muted">This is where page sections (Hero, Features, etc.) render.</p>
      </div>
    ),
  },
};
