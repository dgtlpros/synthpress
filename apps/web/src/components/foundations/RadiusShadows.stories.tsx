import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Foundations/Radius & Shadows",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const radii = [
  {
    name: "sm",
    var: "--sp-radius-sm",
    value: "0.375rem",
    desc: "Badges, small elements",
  },
  {
    name: "md",
    var: "--sp-radius-md",
    value: "0.5rem",
    desc: "Buttons, inputs",
  },
  {
    name: "lg",
    var: "--sp-radius-lg",
    value: "0.75rem",
    desc: "Cards, dropdowns",
  },
  { name: "xl", var: "--sp-radius-xl", value: "1rem", desc: "Modals, panels" },
  {
    name: "full",
    var: "--sp-radius-full",
    value: "9999px",
    desc: "Avatars, pills",
  },
];

const shadows = [
  { name: "sm", var: "--sp-shadow-sm", desc: "Inputs, subtle elevation" },
  { name: "md", var: "--sp-shadow-md", desc: "Cards, dropdowns" },
  { name: "lg", var: "--sp-shadow-lg", desc: "Modals, overlays" },
  {
    name: "glow",
    var: "--sp-shadow-glow",
    desc: "Focus states, brand highlights",
  },
];

export const BorderRadius: Story = {
  render: () => (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Border Radius</h2>
      <div className="flex flex-wrap gap-6">
        {radii.map((r) => (
          <div key={r.name} className="flex flex-col items-center gap-2">
            <div
              className="h-16 w-16 bg-gradient-accent"
              style={{ borderRadius: r.value }}
            />
            <p className="text-xs font-medium text-foreground">{r.name}</p>
            <p className="text-xs text-muted font-mono">{r.value}</p>
            <p className="text-xs text-muted text-center max-w-[100px]">
              {r.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  ),
};

export const Shadows: Story = {
  render: () => (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Shadows</h2>
      <div className="flex flex-wrap gap-8">
        {shadows.map((s) => (
          <div key={s.name} className="flex flex-col items-center gap-2">
            <div
              className="h-20 w-20 bg-surface rounded-xl border border-border"
              style={{ boxShadow: `var(${s.var})` }}
            />
            <p className="text-xs font-medium text-foreground">{s.name}</p>
            <p className="text-xs text-muted font-mono">{s.var}</p>
            <p className="text-xs text-muted text-center max-w-[120px]">
              {s.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  ),
};
