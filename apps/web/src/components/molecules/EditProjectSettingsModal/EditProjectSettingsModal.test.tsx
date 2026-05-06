import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { EditProjectSettingsModal } from "./EditProjectSettingsModal";

afterEach(cleanup);

describe("EditProjectSettingsModal", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("renders fields and footer", () => {
    render(
      <EditProjectSettingsModal
        open
        onClose={vi.fn()}
        projectName="P1"
        description="D1"
        onProjectNameChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        footer={<button type="button">Go</button>}
      />,
    );
    expect(screen.getByLabelText("Project name")).toHaveValue("P1");
    expect(screen.getByLabelText("Description")).toHaveValue("D1");
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("shows error message", () => {
    render(
      <EditProjectSettingsModal
        open
        onClose={vi.fn()}
        projectName=""
        description=""
        onProjectNameChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        errorMessage="Failed"
        footer={null}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
