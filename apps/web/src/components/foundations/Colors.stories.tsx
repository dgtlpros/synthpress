import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Foundations/Colors",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const brandColors = [
  { name: "Navy", var: "--sp-navy", value: "#0f172a" },
  { name: "Navy Light", var: "--sp-navy-light", value: "#1e293b" },
  { name: "Indigo", var: "--sp-indigo", value: "#4338ca" },
  { name: "Blue", var: "--sp-blue", value: "#2563eb" },
  { name: "Cyan", var: "--sp-cyan", value: "#06b6d4" },
  { name: "Purple", var: "--sp-purple", value: "#7c3aed" },
  { name: "Magenta", var: "--sp-magenta", value: "#d946ef" },
  { name: "Pink", var: "--sp-pink", value: "#ec4899" },
  { name: "Lime", var: "--sp-lime", value: "#bfff00" },
  { name: "Lime Light", var: "--sp-lime-light", value: "#dfff66" },
  { name: "Lime Dark", var: "--sp-lime-dark", value: "#4d7c0f" },
];

const semanticColors = [
  { name: "Success", var: "--sp-success", value: "#10b981" },
  { name: "Warning", var: "--sp-warning", value: "#f59e0b" },
  { name: "Error", var: "--sp-error", value: "#ef4444" },
];

const surfaceColors = [
  { name: "Background", var: "--background", tw: "bg-background" },
  { name: "Surface", var: "--surface", tw: "bg-surface" },
  { name: "Surface Hover", var: "--surface-hover", tw: "bg-surface-hover" },
  { name: "Surface Active", var: "--surface-active", tw: "bg-surface-active" },
  { name: "Border", var: "--border", tw: "bg-border" },
  { name: "Muted", var: "--muted", tw: "bg-muted" },
];

function Swatch({
  name,
  value,
  cssVar,
}: {
  name: string;
  value?: string;
  cssVar: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-12 w-12 rounded-lg border border-border shadow-sm"
        style={{ background: value || `var(${cssVar})` }}
      />
      <div>
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="text-xs text-muted font-mono">{cssVar}</p>
        {value && <p className="text-xs text-muted font-mono">{value}</p>}
      </div>
    </div>
  );
}

export const BrandPalette: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">
          Brand Colors
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {brandColors.map((c) => (
            <Swatch key={c.var} name={c.name} value={c.value} cssVar={c.var} />
          ))}
        </div>
      </div>
      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">
          Semantic Colors
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {semanticColors.map((c) => (
            <Swatch key={c.var} name={c.name} value={c.value} cssVar={c.var} />
          ))}
        </div>
      </div>
      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">
          Surface Colors
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {surfaceColors.map((c) => (
            <Swatch key={c.var} name={c.name} cssVar={c.var} />
          ))}
        </div>
      </div>
    </div>
  ),
};
