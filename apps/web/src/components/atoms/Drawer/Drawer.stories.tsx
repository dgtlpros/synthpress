import type { Meta, StoryObj } from "@storybook/react";
import { Drawer } from "./Drawer";

const meta = {
  title: "Atoms/Drawer",
  component: Drawer,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Autopilot run details",
    description: "What this scheduler tick did.",
    children: (
      <div className="space-y-4 text-sm text-foreground">
        <p>
          The drawer body scrolls independently of the header + footer
          so long content (lists of jobs, raw JSON, etc.) doesn&apos;t
          shove the close affordance off-screen.
        </p>
        <p className="text-muted">
          On mobile (&lt; sm) the same component renders as a bottom
          sheet anchored to the bottom edge.
        </p>
      </div>
    ),
    footer: (
      <button
        type="button"
        className="rounded-[var(--sp-radius-lg)] border border-border px-3 py-1.5 text-sm"
      >
        Close
      </button>
    ),
  },
};

export const WideTwoXl: Story = {
  args: {
    ...Open.args,
    width: "2xl",
    title: "Wider drawer",
  },
};
