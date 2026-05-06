import type { Meta, StoryObj } from "@storybook/react";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const meta = {
  title: "Molecules/WorkspaceSidebar",
  component: WorkspaceSidebar,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof WorkspaceSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const teams = [
  {
    id: "team-1",
    name: "Acme Marketing",
    projects: [
      { id: "p-1", name: "Q2 blog engine", teamId: "team-1" },
      { id: "p-2", name: "Client sites", teamId: "team-1" },
    ],
  },
  {
    id: "team-2",
    name: "Personal",
    projects: [{ id: "p-3", name: "Default", teamId: "team-2" }],
  },
];

export const Default: Story = {
  args: { teams, email: "user@synthpress.app" },
  render: (args) => (
    <div className="h-screen bg-background">
      <WorkspaceSidebar {...args} />
    </div>
  ),
};

export const NoTeams: Story = {
  args: { teams: [], email: "user@synthpress.app" },
  render: (args) => (
    <div className="h-screen bg-background">
      <WorkspaceSidebar {...args} />
    </div>
  ),
};
