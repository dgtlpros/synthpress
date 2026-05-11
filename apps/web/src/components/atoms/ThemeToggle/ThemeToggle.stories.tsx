import type { Meta, StoryObj } from "@storybook/react";
import { ThemeProvider } from "../ThemeProvider";
import { ThemeToggle } from "./ThemeToggle";

const meta = {
  title: "Atoms/ThemeToggle",
  component: ThemeToggle,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The toggle is wrapped in its own `<ThemeProvider>` inside each story so
 * the popover state and active option render correctly. In the live app
 * the provider sits at the root layout — there's only one provider for
 * the whole tree.
 */
function ToggleHost({
  defaultTheme = "system" as "light" | "dark" | "system",
}) {
  return (
    <ThemeProvider defaultTheme={defaultTheme}>
      <div className="rounded-[var(--sp-radius-lg)] border border-border bg-surface p-4">
        <ThemeToggle />
      </div>
    </ThemeProvider>
  );
}

export const Default: Story = { render: () => <ToggleHost /> };

export const StartingFromLight: Story = {
  render: () => <ToggleHost defaultTheme="light" />,
};

export const StartingFromDark: Story = {
  render: () => <ToggleHost defaultTheme="dark" />,
};

export const InsideHeader: Story = {
  render: () => (
    <ThemeProvider>
      <div className="flex h-16 w-[480px] items-center justify-between border-b border-border bg-background px-4">
        <span className="text-sm font-semibold text-foreground">Header</span>
        <ThemeToggle />
      </div>
    </ThemeProvider>
  ),
  parameters: { layout: "padded" },
};
