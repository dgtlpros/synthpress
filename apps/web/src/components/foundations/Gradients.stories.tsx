import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Foundations/Gradients",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const gradients = [
  {
    name: "Brand",
    desc: "Indigo → Blue → Cyan",
    className: "bg-gradient-brand",
  },
  {
    name: "Accent",
    desc: "Blue → Purple → Magenta",
    className: "bg-gradient-accent",
  },
  { name: "Glow", desc: "Purple → Magenta", className: "bg-gradient-glow" },
];

export const AllGradients: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">
          Background Gradients
        </h2>
        <div className="space-y-4">
          {gradients.map((g) => (
            <div key={g.name} className="flex items-center gap-4">
              <div className={`h-16 w-64 rounded-xl ${g.className}`} />
              <div>
                <p className="text-sm font-medium text-foreground">{g.name}</p>
                <p className="text-xs text-muted">{g.desc}</p>
                <p className="text-xs text-muted font-mono">.{g.className}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">
          Text Gradients
        </h2>
        <div className="space-y-3">
          <p className="text-3xl font-bold text-gradient-brand">
            Brand gradient text
          </p>
          <p className="text-3xl font-bold text-gradient-accent">
            Accent gradient text
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">
          Gradient Buttons
        </h2>
        <div className="flex gap-3">
          <button className="bg-gradient-accent text-white px-6 py-2.5 rounded-lg font-medium shadow-md hover:brightness-110 transition-all">
            Accent Button
          </button>
          <button className="bg-gradient-brand text-white px-6 py-2.5 rounded-lg font-medium shadow-md hover:brightness-110 transition-all">
            Brand Button
          </button>
          <button className="bg-gradient-glow text-white px-6 py-2.5 rounded-lg font-medium shadow-md hover:brightness-110 transition-all">
            Glow Button
          </button>
        </div>
      </div>
    </div>
  ),
};
