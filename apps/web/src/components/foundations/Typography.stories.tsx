import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Foundations/Typography",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const TypeScale: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">
          Font Family
        </h2>
        <div className="space-y-2">
          <p className="font-sans text-lg text-foreground">
            Geist Sans —{" "}
            <span className="text-muted">
              The quick brown fox jumps over the lazy dog.
            </span>
          </p>
          <p className="font-mono text-lg text-foreground">
            Geist Mono —{" "}
            <span className="text-muted">
              const api = &quot;https://site.kinsta.cloud&quot;
            </span>
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">Scale</h2>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 text-xs font-medium text-muted uppercase">
                Name
              </th>
              <th className="py-2 text-xs font-medium text-muted uppercase">
                Size
              </th>
              <th className="py-2 text-xs font-medium text-muted uppercase">
                Weight
              </th>
              <th className="py-2 text-xs font-medium text-muted uppercase">
                Preview
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-3 text-xs font-mono text-muted">h1</td>
              <td className="py-3 text-xs font-mono text-muted">
                4xl (2.25rem)
              </td>
              <td className="py-3 text-xs text-muted">Bold</td>
              <td className="py-3 text-4xl font-bold text-foreground">
                SynthPress
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-3 text-xs font-mono text-muted">h2</td>
              <td className="py-3 text-xs font-mono text-muted">
                3xl (1.875rem)
              </td>
              <td className="py-3 text-xs text-muted">Semibold</td>
              <td className="py-3 text-3xl font-semibold text-foreground">
                Dashboard
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-3 text-xs font-mono text-muted">h3</td>
              <td className="py-3 text-xs font-mono text-muted">
                2xl (1.5rem)
              </td>
              <td className="py-3 text-xs text-muted">Semibold</td>
              <td className="py-3 text-2xl font-semibold text-foreground">
                Projects
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-3 text-xs font-mono text-muted">h4</td>
              <td className="py-3 text-xs font-mono text-muted">
                xl (1.25rem)
              </td>
              <td className="py-3 text-xs text-muted">Semibold</td>
              <td className="py-3 text-xl font-semibold text-foreground">
                Article History
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-3 text-xs font-mono text-muted">h5</td>
              <td className="py-3 text-xs font-mono text-muted">
                lg (1.125rem)
              </td>
              <td className="py-3 text-xs text-muted">Medium</td>
              <td className="py-3 text-lg font-medium text-foreground">
                Settings
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-3 text-xs font-mono text-muted">body</td>
              <td className="py-3 text-xs font-mono text-muted">base (1rem)</td>
              <td className="py-3 text-xs text-muted">Regular</td>
              <td className="py-3 text-base text-foreground">
                The quick brown fox jumps over the lazy dog.
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-3 text-xs font-mono text-muted">body-sm</td>
              <td className="py-3 text-xs font-mono text-muted">
                sm (0.875rem)
              </td>
              <td className="py-3 text-xs text-muted">Regular</td>
              <td className="py-3 text-sm text-foreground">
                Last published 3 hours ago.
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-3 text-xs font-mono text-muted">caption</td>
              <td className="py-3 text-xs font-mono text-muted">
                xs (0.75rem)
              </td>
              <td className="py-3 text-xs text-muted">Regular</td>
              <td className="py-3 text-xs text-foreground">
                Updated May 3, 2026
              </td>
            </tr>
            <tr>
              <td className="py-3 text-xs font-mono text-muted">overline</td>
              <td className="py-3 text-xs font-mono text-muted">
                xs (0.75rem)
              </td>
              <td className="py-3 text-xs text-muted">Semibold UC</td>
              <td className="py-3 text-xs font-semibold uppercase tracking-wider text-foreground">
                PUBLISHING STATUS
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">
          Font Weights
        </h2>
        <div className="space-y-1">
          <p className="text-lg font-normal text-foreground">
            Regular (400) — body text, descriptions
          </p>
          <p className="text-lg font-medium text-foreground">
            Medium (500) — labels, small headings
          </p>
          <p className="text-lg font-semibold text-foreground">
            Semibold (600) — headings, emphasis
          </p>
          <p className="text-lg font-bold text-foreground">
            Bold (700) — hero headings, primary titles
          </p>
        </div>
      </div>
    </div>
  ),
};
