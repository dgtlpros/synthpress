import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(cleanup);

describe("DeleteConfirmModal", () => {
  it("renders title and required phrase in body text", () => {
    render(
      <DeleteConfirmModal
        open
        entityKind="team"
        requiredPhrase="My Team"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: /delete team/i })).toBeInTheDocument();
    expect(screen.getByText(/My Team/)).toBeInTheDocument();
  });

  it("keeps Delete button disabled until the phrase is typed correctly", () => {
    render(
      <DeleteConfirmModal
        open
        entityKind="project"
        requiredPhrase="Alpha"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /delete project/i });
    expect(button).toBeDisabled();

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Alph" } });
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "Alpha" } });
    expect(button).toBeEnabled();
  });

  it("calls onConfirm when Delete is clicked with correct phrase", () => {
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmModal
        open
        entityKind="team"
        requiredPhrase="Acme"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /delete team/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <DeleteConfirmModal
        open
        entityKind="team"
        requiredPhrase="Acme"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("disables all controls when loading", () => {
    render(
      <DeleteConfirmModal
        open
        entityKind="team"
        requiredPhrase="X"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        loading
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "X" } });
    expect(screen.getByRole("button", { name: /deleting/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });

  it("calls onCancel when backdrop (dialog element itself) is clicked", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <DeleteConfirmModal
        open
        entityKind="team"
        requiredPhrase="X"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(container.querySelector("dialog")!);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
