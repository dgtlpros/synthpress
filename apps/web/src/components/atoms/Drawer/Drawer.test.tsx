import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Drawer } from "./Drawer";

beforeEach(() => {
  // jsdom doesn't implement <dialog>.showModal/close — same shim
  // pattern Modal's tests use, just inline.
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

describe("Drawer", () => {
  it("renders title + description + children when open", () => {
    render(
      <Drawer
        open
        title="Run details"
        description="Audit log for one tick"
        onClose={vi.fn()}
      >
        <p>Body content</p>
      </Drawer>,
    );
    expect(
      screen.getByRole("heading", { name: "Run details" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Audit log for one tick")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("renders the optional footer when provided", () => {
    render(
      <Drawer
        open
        title="T"
        onClose={vi.fn()}
        footer={<button type="button">Action</button>}
      >
        body
      </Drawer>,
    );
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
  });

  it("calls onClose when the user clicks the X button", () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="T" onClose={onClose}>
        body
      </Drawer>,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the dialog fires a cancel event (Escape key)", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Drawer open title="T" onClose={onClose}>
        body
      </Drawer>,
    );
    fireEvent(
      container.querySelector("dialog")!,
      new Event("cancel", { cancelable: true }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop (dialog element) is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Drawer open title="T" onClose={onClose}>
        body
      </Drawer>,
    );
    fireEvent.click(container.querySelector("dialog")!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does NOT call onClose when content inside is clicked", () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="T" onClose={onClose}>
        <p data-testid="content">body</p>
      </Drawer>,
    );
    fireEvent.click(screen.getByTestId("content"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls dialog.close() when open transitions to false", () => {
    const { rerender } = render(
      <Drawer open title="T" onClose={vi.fn()}>
        body
      </Drawer>,
    );
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();

    rerender(
      <Drawer open={false} title="T" onClose={vi.fn()}>
        body
      </Drawer>,
    );
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  it("applies the requested width class on sm+ viewports", () => {
    const { container } = render(
      <Drawer open title="T" onClose={vi.fn()} width="2xl">
        body
      </Drawer>,
    );
    expect(container.querySelector("dialog")).toHaveClass("sm:max-w-2xl");
  });

  it("defaults to lg width when not specified", () => {
    const { container } = render(
      <Drawer open title="T" onClose={vi.fn()}>
        body
      </Drawer>,
    );
    expect(container.querySelector("dialog")).toHaveClass("sm:max-w-lg");
  });
});
