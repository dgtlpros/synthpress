import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Modal } from "./Modal";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(cleanup);

describe("Modal", () => {
  it("renders title and children when open", () => {
    render(
      <Modal open title="Edit" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole("heading", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("renders optional description", () => {
    render(
      <Modal open title="T" description="Sub" onClose={vi.fn()}>
        x
      </Modal>,
    );
    expect(screen.getByText("Sub")).toBeInTheDocument();
  });

  it("renders footer", () => {
    render(
      <Modal open title="T" onClose={vi.fn()} footer={<button type="button">Save</button>}>
        x
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("calls onClose when dialog fires cancel", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open title="T" onClose={onClose}>
        x
      </Modal>,
    );
    const dialog = container.querySelector("dialog");
    expect(dialog).toBeTruthy();
    fireEvent(dialog!, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
