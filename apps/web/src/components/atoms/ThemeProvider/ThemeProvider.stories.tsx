import type { Meta, StoryObj } from "@storybook/react";
import { useTheme } from "next-themes";
import { ThemeProvider } from "./ThemeProvider";

const meta = {
  title: "Atoms/ThemeProvider",
  component: ThemeProvider,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ThemeProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

function ThemePreview() {
  const { theme, resolvedTheme, themes } = useTheme();
  return (
    <div className="space-y-3 rounded-[var(--sp-radius-lg)] border border-border bg-surface p-4 text-sm text-foreground">
      <p>
        <span className="font-semibold text-muted">theme:</span>{" "}
        <code className="font-mono">{theme ?? "—"}</code>
      </p>
      <p>
        <span className="font-semibold text-muted">resolvedTheme:</span>{" "}
        <code className="font-mono">{resolvedTheme ?? "—"}</code>
      </p>
      <p>
        <span className="font-semibold text-muted">themes:</span>{" "}
        <code className="font-mono">{themes.join(", ")}</code>
      </p>
    </div>
  );
}

export const Default: Story = {
  args: { children: <ThemePreview /> },
};

export const ForcedDark: Story = {
  name: "Default Theme: Dark",
  args: { defaultTheme: "dark", children: <ThemePreview /> },
};

export const ForcedLight: Story = {
  name: "Default Theme: Light",
  args: { defaultTheme: "light", children: <ThemePreview /> },
};
