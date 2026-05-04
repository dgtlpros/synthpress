import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Toggle } from "./Toggle";

const meta = {
  title: "Atoms/Toggle",
  component: Toggle,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

function ToggleDemo({ defaultChecked = false }: { defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  return <Toggle checked={checked} onChange={setChecked} />;
}

export const Off: Story = { render: () => <ToggleDemo /> };
export const On: Story = { render: () => <ToggleDemo defaultChecked /> };
export const Disabled: Story = { args: { checked: false, disabled: true } };
