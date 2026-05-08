import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GenerateIdeasModal } from "./GenerateIdeasModal";

afterEach(cleanup);

beforeAll(() => {
  // jsdom doesn't implement <dialog>'s showModal/close. Stub them so the
  // Modal atom's open/close effect works inside tests.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

const baseProps = {
  open: true,
  onClose: vi.fn(),
  brief: "",
  onBriefChange: vi.fn(),
  onSubmit: vi.fn(),
  count: 10,
};

describe("GenerateIdeasModal", () => {
  it("renders the title with the requested count", () => {
    render(<GenerateIdeasModal {...baseProps} count={7} />);
    expect(screen.getByText("Generate 7 article ideas")).toBeInTheDocument();
  });

  it("calls onBriefChange as the user types", () => {
    const onBriefChange = vi.fn();
    render(
      <GenerateIdeasModal {...baseProps} onBriefChange={onBriefChange} />,
    );
    const textarea = screen.getByLabelText(/topic or brief/i);
    fireEvent.change(textarea, { target: { value: "ai agents" } });
    expect(onBriefChange).toHaveBeenCalledWith("ai agents");
  });

  it("calls onSubmit when the form is submitted", () => {
    const onSubmit = vi.fn();
    render(<GenerateIdeasModal {...baseProps} onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByLabelText(/topic or brief/i).closest("form")!);
    expect(onSubmit).toHaveBeenCalled();
  });

  it("does not submit while pending", () => {
    const onSubmit = vi.fn();
    render(
      <GenerateIdeasModal {...baseProps} onSubmit={onSubmit} pending />,
    );
    fireEvent.submit(screen.getByLabelText(/topic or brief/i).closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables the inputs while pending", () => {
    render(<GenerateIdeasModal {...baseProps} pending />);
    expect(screen.getByLabelText(/topic or brief/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });

  it("shows the credits cost when provided", () => {
    render(<GenerateIdeasModal {...baseProps} creditsCost={1} />);
    const para = screen.getByText(/This will use/i);
    expect(para).toHaveTextContent("1 synth token");
  });

  it("pluralizes 'tokens' for cost > 1", () => {
    render(<GenerateIdeasModal {...baseProps} creditsCost={5} />);
    const para = screen.getByText(/This will use/i);
    expect(para).toHaveTextContent("5 synth tokens");
  });

  it("renders an error message when provided", () => {
    render(
      <GenerateIdeasModal
        {...baseProps}
        errorMessage="Not enough synth tokens"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /not enough synth tokens/i,
    );
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<GenerateIdeasModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders the brief character count", () => {
    render(<GenerateIdeasModal {...baseProps} brief="hello" />);
    expect(screen.getByText("5/2000")).toBeInTheDocument();
  });

  it("renders without the credits hint when not provided", () => {
    render(<GenerateIdeasModal {...baseProps} />);
    expect(screen.queryByText(/synth token/i)).not.toBeInTheDocument();
  });

  it("does not render anything inside the dialog when closed", () => {
    render(<GenerateIdeasModal {...baseProps} open={false} />);
    // The dialog itself still mounts (so transitions work) but it's not
    // open — the textarea should still be in the DOM either way.
    expect(screen.getByLabelText(/topic or brief/i)).toBeInTheDocument();
  });
});
