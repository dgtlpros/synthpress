import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "./Table";

afterEach(cleanup);

describe("Table", () => {
  it("renders header cells and rows", () => {
    render(
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Title</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Hello</TableCell>
            <TableCell>Draft</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("applies the interactive class to TableRow when set", () => {
    render(
      <table>
        <tbody>
          <TableRow interactive data-testid="row">
            <TableCell>cell</TableCell>
          </TableRow>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("row").className).toMatch(/cursor-pointer/);
  });

  it("forwards container className", () => {
    render(
      <Table containerClassName="my-wrapper" data-testid="t">
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByTestId("t").parentElement?.className).toMatch(
      /my-wrapper/,
    );
  });
});
