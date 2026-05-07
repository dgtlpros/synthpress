import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { CreateAppChoiceModal } from "./CreateAppChoiceModal";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(cleanup);

const baseProps = {
  open: true,
  onClose: vi.fn(),
  step: "choose" as const,
  onChooseBlog: vi.fn(),
  onBack: vi.fn(),
  blogName: "",
  onBlogNameChange: vi.fn(),
  onCreateBlog: vi.fn(),
};

describe("CreateAppChoiceModal — choose step", () => {
  it("renders the Blog option", () => {
    render(<CreateAppChoiceModal {...baseProps} />);
    expect(screen.getByRole("option", { name: /Blog/i })).toBeInTheDocument();
  });

  it("describes the friction-free flow in the option copy", () => {
    render(<CreateAppChoiceModal {...baseProps} />);
    expect(
      screen.getByText(/Connect a WordPress site whenever/i),
    ).toBeInTheDocument();
  });

  it("calls onChooseBlog when the Blog option is clicked", () => {
    const onChooseBlog = vi.fn();
    render(<CreateAppChoiceModal {...baseProps} onChooseBlog={onChooseBlog} />);
    fireEvent.click(screen.getByRole("option", { name: /Blog/i }));
    expect(onChooseBlog).toHaveBeenCalledOnce();
  });
});

describe("CreateAppChoiceModal — name step", () => {
  it("renders the name input and Create blog button", () => {
    render(<CreateAppChoiceModal {...baseProps} step="name" />);
    expect(screen.getByLabelText(/blog name/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create blog/i }),
    ).toBeInTheDocument();
  });

  it("disables Create blog when name is empty", () => {
    render(<CreateAppChoiceModal {...baseProps} step="name" blogName="" />);
    expect(screen.getByRole("button", { name: /create blog/i })).toBeDisabled();
  });

  it("enables Create blog when a non-empty name is entered", () => {
    render(
      <CreateAppChoiceModal {...baseProps} step="name" blogName="Main site" />,
    );
    expect(
      screen.getByRole("button", { name: /create blog/i }),
    ).not.toBeDisabled();
  });

  it("calls onBlogNameChange as user types", () => {
    const onBlogNameChange = vi.fn();
    render(
      <CreateAppChoiceModal
        {...baseProps}
        step="name"
        blogName=""
        onBlogNameChange={onBlogNameChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/blog name/i), {
      target: { value: "Main site" },
    });
    expect(onBlogNameChange).toHaveBeenCalledWith("Main site");
  });

  it("calls onCreateBlog when the form is submitted", () => {
    const onCreateBlog = vi.fn();
    render(
      <CreateAppChoiceModal
        {...baseProps}
        step="name"
        blogName="Main site"
        onCreateBlog={onCreateBlog}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create blog/i }));
    expect(onCreateBlog).toHaveBeenCalledOnce();
  });

  it("does not call onCreateBlog when pending", () => {
    const onCreateBlog = vi.fn();
    render(
      <CreateAppChoiceModal
        {...baseProps}
        step="name"
        blogName="Main site"
        pending
        onCreateBlog={onCreateBlog}
      />,
    );
    const form = screen
      .getByRole("button", { name: /create blog/i })
      .closest("form")!;
    fireEvent.submit(form);
    expect(onCreateBlog).not.toHaveBeenCalled();
  });

  it("calls onBack when the Back button is clicked", () => {
    const onBack = vi.fn();
    render(
      <CreateAppChoiceModal
        {...baseProps}
        step="name"
        blogName="Main site"
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders an error message when one is provided", () => {
    render(
      <CreateAppChoiceModal
        {...baseProps}
        step="name"
        blogName="Main site"
        errorMessage="Slug already exists"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/slug already exists/i);
  });
});
