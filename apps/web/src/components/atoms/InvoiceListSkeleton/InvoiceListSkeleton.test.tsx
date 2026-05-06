import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { InvoiceListSkeleton } from "./InvoiceListSkeleton";

afterEach(cleanup);

describe("InvoiceListSkeleton", () => {
  it("renders 4 placeholder rows by default", () => {
    const { container } = render(<InvoiceListSkeleton />);
    expect(screen.getByTestId("invoice-list-skeleton")).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(4);
  });

  it("renders a custom number of rows", () => {
    const { container } = render(<InvoiceListSkeleton rows={7} />);
    expect(container.querySelectorAll("li")).toHaveLength(7);
  });

  it("forwards a custom className to the root", () => {
    render(<InvoiceListSkeleton className="custom-skeleton" />);
    expect(screen.getByTestId("invoice-list-skeleton")).toHaveClass(
      "custom-skeleton",
    );
  });
});
