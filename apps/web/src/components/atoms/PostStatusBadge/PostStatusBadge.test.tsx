import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  POST_STATUSES,
  PostStatusBadge,
  getPostStatusLabel,
} from "./PostStatusBadge";

afterEach(cleanup);

describe("PostStatusBadge", () => {
  it("renders every status with a human-friendly label", () => {
    POST_STATUSES.forEach((status) => {
      const { unmount } = render(<PostStatusBadge status={status} />);
      expect(screen.getByText(getPostStatusLabel(status))).toBeInTheDocument();
      unmount();
    });
  });

  it("uses 'Ready for review' label for the ready status", () => {
    render(<PostStatusBadge status="ready" />);
    expect(screen.getByText("Ready for review")).toBeInTheDocument();
  });

  it("forwards className", () => {
    render(<PostStatusBadge status="published" className="my-badge" />);
    expect(screen.getByText("Published").className).toMatch(/my-badge/);
  });

  it("supports a size prop", () => {
    render(<PostStatusBadge status="draft" size="sm" />);
    const node = screen.getByText("Draft");
    expect(node.className).toMatch(/text-xs/);
  });
});
