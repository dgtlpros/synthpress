import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ProjectsListToolbar } from "./ProjectsListToolbar";

afterEach(cleanup);

describe("ProjectsListToolbar", () => {
  it("calls onSearchChange", () => {
    const onSearchChange = vi.fn();
    render(
      <ProjectsListToolbar
        searchQuery=""
        onSearchChange={onSearchChange}
        sortKey="name-asc"
        onSortChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Search projects/), {
      target: { value: "x" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("x");
  });

  it("calls onSortChange", () => {
    const onSortChange = vi.fn();
    render(
      <ProjectsListToolbar
        searchQuery=""
        onSearchChange={vi.fn()}
        sortKey="name-asc"
        onSortChange={onSortChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Sort/), {
      target: { value: "newest" },
    });
    expect(onSortChange).toHaveBeenCalledWith("newest");
  });
});
