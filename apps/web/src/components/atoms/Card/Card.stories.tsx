import type { Meta, StoryObj } from "@storybook/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./Card";

const meta = {
  title: "Atoms/Card",
  component: Card,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-[360px]">
      <CardHeader>
        <CardTitle>SynthPress Fitness</CardTitle>
        <CardDescription>2 articles/day &middot; fitness niche</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted">Last published 3 hours ago</p>
      </CardContent>
      <CardFooter>
        <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full bg-success/10 text-success border border-success/20">
          Active
        </span>
      </CardFooter>
    </Card>
  ),
};

export const Ghost: Story = {
  render: () => (
    <Card variant="ghost" className="w-[360px]">
      <CardContent>Ghost card — no border or shadow</CardContent>
    </Card>
  ),
};
