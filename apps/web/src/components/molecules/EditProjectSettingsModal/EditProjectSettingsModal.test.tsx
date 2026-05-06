import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { EditProjectSettingsModal } from "./EditProjectSettingsModal";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(cleanup);

describe("EditProjectSettingsModal", () => {
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

  it("calls onProjectNameChange when name input changes", () => {
    const onChange = vi.fn();
    render(
      <EditProjectSettingsModal
        open
        onClose={vi.fn()}
        projectName="P1"
        description=""
        onProjectNameChange={onChange}
        onDescriptionChange={vi.fn()}
        footer={null}
      />,
    );
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "New" } });
    expect(onChange).toHaveBeenCalledWith("New");
  });

  it("calls onDescriptionChange when description input changes", () => {
    const onChange = vi.fn();
    render(
      <EditProjectSettingsModal
        open
        onClose={vi.fn()}
        projectName="P1"
        description=""
        onProjectNameChange={vi.fn()}
        onDescriptionChange={onChange}
        footer={null}
      />,
    );
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Updated" } });
    expect(onChange).toHaveBeenCalledWith("Updated");
  });

  it("disables inputs when pending", () => {
    render(
      <EditProjectSettingsModal
        open
        onClose={vi.fn()}
        projectName="P1"
        description="D1"
        onProjectNameChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        pending
        footer={null}
      />,
    );
    expect(screen.getByLabelText("Project name")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
  });

  it("does not show error when errorMessage is null", () => {
    render(
      <EditProjectSettingsModal
        open
        onClose={vi.fn()}
        projectName="P1"
        description=""
        onProjectNameChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        errorMessage={null}
        footer={null}
      />,
    );
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });
});
