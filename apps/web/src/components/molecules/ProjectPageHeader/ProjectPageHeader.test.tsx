import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ProjectPageHeader } from "./ProjectPageHeader";

afterEach(cleanup);

describe("ProjectPageHeader", () => {
  it("renders title and team", () => {
    render(
      <ProjectPageHeader
        projectName="Alpha"
        teamName="Crew"
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByText("Crew")).toBeInTheDocument();
  });

  it("shows description preview when provided", () => {
    render(
      <ProjectPageHeader
        projectName="P"
        teamName="T"
        descriptionPreview="  Hello world  "
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("calls onOpenSettings when button clicked", () => {
    const onOpenSettings = vi.fn();
    render(
      <ProjectPageHeader
        projectName="P"
        teamName="T"
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Project settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
