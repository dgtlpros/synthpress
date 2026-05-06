import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditTeamSettingsModal } from "./EditTeamSettingsModal";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(cleanup);

describe("EditTeamSettingsModal", () => {
  it("renders team name input with current value", () => {
    render(
      <EditTeamSettingsModal
        open={false}
        onClose={vi.fn()}
        teamName="Acme"
        onTeamNameChange={vi.fn()}
        footer={null}
      />,
    );

    expect(screen.getByLabelText(/team name/i)).toHaveValue("Acme");
  });

  it("calls onTeamNameChange when input changes", () => {
    const onChange = vi.fn();
    render(
      <EditTeamSettingsModal
        open={false}
        onClose={vi.fn()}
        teamName="Acme"
        onTeamNameChange={onChange}
        footer={null}
      />,
    );

    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: "Beta" },
    });
    expect(onChange).toHaveBeenCalledWith("Beta");
  });

  it("displays error message when provided", () => {
    render(
      <EditTeamSettingsModal
        open={false}
        onClose={vi.fn()}
        teamName="Acme"
        onTeamNameChange={vi.fn()}
        errorMessage="Team name is required."
        footer={null}
      />,
    );

    expect(screen.getByText("Team name is required.")).toBeInTheDocument();
  });

  it("disables input when pending", () => {
    render(
      <EditTeamSettingsModal
        open={false}
        onClose={vi.fn()}
        teamName="Acme"
        onTeamNameChange={vi.fn()}
        pending
        footer={null}
      />,
    );

    expect(screen.getByLabelText(/team name/i)).toBeDisabled();
  });
});
