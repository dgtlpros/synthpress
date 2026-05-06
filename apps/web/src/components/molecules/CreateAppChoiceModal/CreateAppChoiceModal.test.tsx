import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { CreateAppChoiceModal } from "./CreateAppChoiceModal";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(cleanup);

describe("CreateAppChoiceModal", () => {
  it("renders blog link", () => {
    render(
      <CreateAppChoiceModal open onClose={vi.fn()} blogSetupHref="/teams/t/p/blogs" />,
    );
    expect(screen.getByRole("option", { name: /Blog/i })).toHaveAttribute("href", "/teams/t/p/blogs");
  });

  it("calls onAfterChooseBlog when Blog option is clicked", () => {
    const onAfterChooseBlog = vi.fn();
    render(
      <CreateAppChoiceModal
        open
        onClose={vi.fn()}
        blogSetupHref="/teams/t/p/blogs"
        onAfterChooseBlog={onAfterChooseBlog}
      />,
    );
    fireEvent.click(screen.getByRole("option", { name: /Blog/i }));
    expect(onAfterChooseBlog).toHaveBeenCalledOnce();
  });
});
