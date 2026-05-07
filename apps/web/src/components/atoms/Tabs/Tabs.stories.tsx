import type { Meta, StoryObj } from "@storybook/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

const meta = {
  title: "Atoms/Tabs",
  component: Tabs,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  args: { defaultValue: "posts" },
  render: (args) => (
    <Tabs {...args} className="w-[480px]">
      <TabsList ariaLabel="Blog sections">
        <TabsTrigger value="posts" count={12}>
          Posts
        </TabsTrigger>
        <TabsTrigger value="queue" count={3}>
          Queue
        </TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="posts" className="mt-4 text-sm text-foreground">
        12 posts: 4 drafts, 6 published, 2 scheduled.
      </TabsContent>
      <TabsContent value="queue" className="mt-4 text-sm text-foreground">
        3 generations are running.
      </TabsContent>
      <TabsContent value="calendar" className="mt-4 text-sm text-foreground">
        Calendar view goes here.
      </TabsContent>
      <TabsContent value="settings" className="mt-4 text-sm text-foreground">
        Settings panel.
      </TabsContent>
    </Tabs>
  ),
};

export const Vertical: Story = {
  args: { defaultValue: "general", orientation: "vertical" },
  render: (args) => (
    <Tabs {...args} className="w-[600px]">
      <TabsList ariaLabel="Settings">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="ai">AI Instructions</TabsTrigger>
        <TabsTrigger value="seo">SEO</TabsTrigger>
        <TabsTrigger value="automation">Automation</TabsTrigger>
        <TabsTrigger value="publishing">Publishing</TabsTrigger>
      </TabsList>
      <TabsContent value="general" className="text-sm text-foreground">
        General settings.
      </TabsContent>
      <TabsContent value="ai" className="text-sm text-foreground">
        AI instructions.
      </TabsContent>
      <TabsContent value="seo" className="text-sm text-foreground">
        SEO defaults.
      </TabsContent>
      <TabsContent value="automation" className="text-sm text-foreground">
        Automation rules.
      </TabsContent>
      <TabsContent value="publishing" className="text-sm text-foreground">
        Publishing destinations.
      </TabsContent>
    </Tabs>
  ),
};

export const WithDisabled: Story = {
  args: { defaultValue: "drafts" },
  render: (args) => (
    <Tabs {...args} className="w-[420px]">
      <TabsList>
        <TabsTrigger value="all" count={42}>
          All
        </TabsTrigger>
        <TabsTrigger value="drafts" count={5}>
          Drafts
        </TabsTrigger>
        <TabsTrigger value="archived" disabled>
          Archived
        </TabsTrigger>
      </TabsList>
      <TabsContent value="all" className="mt-4 text-sm">
        All posts
      </TabsContent>
      <TabsContent value="drafts" className="mt-4 text-sm">
        5 drafts
      </TabsContent>
    </Tabs>
  ),
};
