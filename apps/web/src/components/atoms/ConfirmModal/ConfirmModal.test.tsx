import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { ConfirmModal } from "./ConfirmModal";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(cleanup);

describe("ConfirmModal", () => {
  const defaultProps = {
    open: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    title: "Confirm action",
    message: "Are you sure you want to proceed?",
  };

  it("renders title and message when open", () => {
    render(<ConfirmModal {...defaultProps} />);
    expect(screen.getByText("Confirm action")).toBeInTheDocument();
    expect(screen.getByText("Are you sure you want to proceed?")).toBeInTheDocument();
  });

  it("renders default button labels", () => {
    render(<ConfirmModal {...defaultProps} />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
  });

  it("renders custom button labels", () => {
    render(<ConfirmModal {...defaultProps} confirmLabel="Yes, delete" cancelLabel="No, keep" />);
    expect(screen.getByText("Yes, delete")).toBeInTheDocument();
    expect(screen.getByText("No, keep")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmModal {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows loading state on confirm button", () => {
    render(<ConfirmModal {...defaultProps} loading />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Confirm")).not.toBeInTheDocument();
  });

  it("disables buttons when loading", () => {
    render(<ConfirmModal {...defaultProps} loading />);
    expect(screen.getByText("Cancel")).toBeDisabled();
    expect(screen.getByText("Loading...")).toBeDisabled();
  });

  it("calls showModal when open changes to true", () => {
    const { rerender } = render(<ConfirmModal {...defaultProps} open={false} />);
    rerender(<ConfirmModal {...defaultProps} open={true} />);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("calls close when open changes to false", () => {
    const { rerender } = render(<ConfirmModal {...defaultProps} open={true} />);
    rerender(<ConfirmModal {...defaultProps} open={false} />);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  it("calls onCancel when dialog fires cancel event (escape key)", () => {
    const onCancel = vi.fn();
    render(<ConfirmModal {...defaultProps} onCancel={onCancel} />);
    const dialog = screen.getByText("Confirm action").closest("dialog")!;
    dialog.dispatchEvent(new Event("cancel", { bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
