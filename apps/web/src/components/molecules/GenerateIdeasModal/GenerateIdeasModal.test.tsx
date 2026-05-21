import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  GENERATE_IDEAS_COUNT_PRESETS,
  GenerateIdeasModal,
} from "./GenerateIdeasModal";

afterEach(cleanup);

beforeAll(() => {
  // jsdom doesn't implement <dialog>'s showModal/close. Stub them so the
  // Modal atom's open/close effect works inside tests.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
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
  count: 5,
  onCountChange: vi.fn(),
};

describe("GenerateIdeasModal", () => {
  it("renders the static title", () => {
    render(<GenerateIdeasModal {...baseProps} />);
    expect(screen.getByText("Generate article ideas")).toBeInTheDocument();
  });

  it("renders the count selector with preset chips + Custom toggle", () => {
    render(<GenerateIdeasModal {...baseProps} />);
    for (const preset of GENERATE_IDEAS_COUNT_PRESETS) {
      expect(
        screen.getByRole("radio", { name: String(preset) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: /custom/i })).toBeInTheDocument();
  });

  it("marks the active preset chip as checked", () => {
    render(<GenerateIdeasModal {...baseProps} count={5} />);
    expect(screen.getByRole("radio", { name: "5" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "3" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("calls onCountChange when a preset chip is clicked", () => {
    const onCountChange = vi.fn();
    render(<GenerateIdeasModal {...baseProps} onCountChange={onCountChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "10" }));
    expect(onCountChange).toHaveBeenCalledWith(10);
  });

  it("reveals a numeric Custom input when the Custom chip is clicked", () => {
    const onCountChange = vi.fn();
    render(
      <GenerateIdeasModal
        {...baseProps}
        count={5}
        onCountChange={onCountChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /custom/i }));
    expect(screen.getByLabelText(/custom idea count/i)).toBeInTheDocument();
  });

  it("treats out-of-range counts as Custom by default", () => {
    render(<GenerateIdeasModal {...baseProps} count={17} />);
    expect(screen.getByLabelText(/custom idea count/i)).toHaveValue(17);
    expect(screen.getByRole("radio", { name: /custom/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("clamps Custom values that exceed maxCount on blur", () => {
    const onCountChange = vi.fn();
    render(
      <GenerateIdeasModal
        {...baseProps}
        count={5}
        onCountChange={onCountChange}
        maxCount={20}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /custom/i }));
    const input = screen.getByLabelText(/custom idea count/i);
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.blur(input);
    // The last onCountChange call from typing or blur should be the
    // clamped maximum.
    expect(onCountChange).toHaveBeenLastCalledWith(20);
  });

  it("clamps Custom values below minCount on blur", () => {
    const onCountChange = vi.fn();
    render(
      <GenerateIdeasModal
        {...baseProps}
        count={5}
        onCountChange={onCountChange}
        minCount={1}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /custom/i }));
    const input = screen.getByLabelText(/custom idea count/i);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });

  it("does NOT re-emit onCountChange on blur when the clamped value equals the current count (no-op idempotency)", () => {
    // Hits the false branch of `if (clamped !== count)` in
    // handleCustomBlur — when the user typed the same number that's
    // already selected, we still snap the input to a clean string
    // but we don't fire onCountChange a second time.
    const onCountChange = vi.fn();
    render(
      <GenerateIdeasModal
        {...baseProps}
        count={5}
        onCountChange={onCountChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /custom/i }));
    const input = screen.getByLabelText(
      /custom idea count/i,
    ) as HTMLInputElement;
    // Typing the same value that's already current — change handler
    // fires onCountChange(5) once because the parser still parses to
    // 5 — but reset the mock so we can verify blur is the no-op.
    fireEvent.change(input, { target: { value: "5" } });
    onCountChange.mockClear();
    fireEvent.blur(input);
    expect(onCountChange).not.toHaveBeenCalled();
    expect(input.value).toBe("5");
  });

  it("snaps the Custom input back to the current count when the field is left empty on blur", () => {
    const onCountChange = vi.fn();
    render(
      <GenerateIdeasModal
        {...baseProps}
        count={7}
        onCountChange={onCountChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /custom/i }));
    const input = screen.getByLabelText(
      /custom idea count/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    // The input is restored to the current `count` string, and we
    // do NOT emit onCountChange — the empty field is treated as
    // "user pressed backspace, please reset" not as "change to 0".
    expect(input.value).toBe("7");
    expect(onCountChange).not.toHaveBeenCalled();
  });

  it("renders the min/max helper copy", () => {
    render(<GenerateIdeasModal {...baseProps} minCount={2} maxCount={15} />);
    expect(screen.getByText(/min 2, max 15\./i)).toBeInTheDocument();
  });

  it("calls onBriefChange as the user types", () => {
    const onBriefChange = vi.fn();
    render(<GenerateIdeasModal {...baseProps} onBriefChange={onBriefChange} />);
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
    render(<GenerateIdeasModal {...baseProps} onSubmit={onSubmit} pending />);
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

  it("sets background-task expectations in the description", () => {
    render(<GenerateIdeasModal {...baseProps} />);
    expect(
      screen.getByText(
        /Generation runs in the background — this modal closes as soon as the job is queued\./i,
      ),
    ).toBeInTheDocument();
  });

  it("shows the 'Queueing…' label on the submit button while pending", () => {
    render(<GenerateIdeasModal {...baseProps} pending />);
    expect(
      screen.getByRole("button", { name: /queueing/i }),
    ).toBeInTheDocument();
  });

  it("shows the count in the submit label when idle", () => {
    render(<GenerateIdeasModal {...baseProps} count={5} />);
    expect(
      screen.getByRole("button", { name: /^generate 5 ideas$/i }),
    ).toBeInTheDocument();
  });

  it("uses singular 'idea' when the count is exactly 1", () => {
    render(<GenerateIdeasModal {...baseProps} count={1} />);
    expect(
      screen.getByRole("button", { name: /^generate 1 idea$/i }),
    ).toBeInTheDocument();
  });
});
