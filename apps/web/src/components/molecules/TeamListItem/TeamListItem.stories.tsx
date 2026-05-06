import type { Meta, StoryObj } from "@storybook/react";
import { TeamListItem } from "./TeamListItem";

const meta: Meta<typeof TeamListItem> = {
  title: "Molecules/TeamListItem",
  component: TeamListItem,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof TeamListItem>;

export const OwnedTeam: Story = {
  args: {
    href: "/teams/demo/projects",
    name: "Marketing",
    ownerLabel: "You",
    ownerInitials: "ME",
    memberCount: 4,
    projectCount: 2,
    planDisplayName: "Pro",
    planStatus: "active",
    balance: 8420,
  },
};

export const JoinedTeam: Story = {
  args: {
    href: "/teams/demo2/projects",
    name: "Client workspace",
    ownerLabel: "Owned by Alex Rivera",
    ownerInitials: "AR",
    memberCount: 12,
    projectCount: 6,
    planDisplayName: "Scale",
    planStatus: "trialing",
    balance: 500,
  },
};

export const FreePlan: Story = {
  args: {
    href: "/teams/demo3/projects",
    name: "Side project",
    ownerLabel: "You",
    ownerInitials: "SP",
    memberCount: 1,
    projectCount: 1,
    planDisplayName: "Free",
    planStatus: null,
    balance: 0,
  },
};
