import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Foundations/Spacing",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const spacingScale = [
  { name: "0.5", rem: "0.125rem", px: "2px" },
  { name: "1", rem: "0.25rem", px: "4px" },
  { name: "1.5", rem: "0.375rem", px: "6px" },
  { name: "2", rem: "0.5rem", px: "8px" },
  { name: "3", rem: "0.75rem", px: "12px" },
  { name: "4", rem: "1rem", px: "16px" },
  { name: "5", rem: "1.25rem", px: "20px" },
  { name: "6", rem: "1.5rem", px: "24px" },
  { name: "8", rem: "2rem", px: "32px" },
  { name: "10", rem: "2.5rem", px: "40px" },
  { name: "12", rem: "3rem", px: "48px" },
  { name: "16", rem: "4rem", px: "64px" },
  { name: "20", rem: "5rem", px: "80px" },
  { name: "24", rem: "6rem", px: "96px" },
];

export const SpacingScale: Story = {
  render: () => (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Spacing Scale (Tailwind default)</h2>
      <div className="space-y-2">
        {spacingScale.map((s) => (
          <div key={s.name} className="flex items-center gap-4">
            <span className="w-12 text-right text-xs font-mono text-muted">{s.name}</span>
            <div className="bg-gradient-accent rounded" style={{ height: "20px", width: s.px }} />
            <span className="text-xs text-muted font-mono">{s.rem} / {s.px}</span>
          </div>
        ))}
      </div>
    </div>
  ),
};
