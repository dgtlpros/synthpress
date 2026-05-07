import type { Meta, StoryObj } from "@storybook/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "./Table";

const meta = {
  title: "Atoms/Table",
  component: Table,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Title</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Word count</TableHeaderCell>
          <TableHeaderCell>Updated</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell>The complete guide to AI blogging</TableCell>
          <TableCell>Draft</TableCell>
          <TableCell>1,820</TableCell>
          <TableCell>2 hours ago</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>10 SEO tactics that still work in 2026</TableCell>
          <TableCell>Published</TableCell>
          <TableCell>2,140</TableCell>
          <TableCell>Yesterday</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            Why content velocity matters more than perfection
          </TableCell>
          <TableCell>Scheduled</TableCell>
          <TableCell>980</TableCell>
          <TableCell>Just now</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const Interactive: Story = {
  render: () => (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Topic</TableHeaderCell>
          <TableHeaderCell>Persona</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow interactive>
          <TableCell>Getting started with synthetic biology</TableCell>
          <TableCell>Editorial team</TableCell>
        </TableRow>
        <TableRow interactive>
          <TableCell>Comparing AI writing assistants</TableCell>
          <TableCell>Editorial team</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};
