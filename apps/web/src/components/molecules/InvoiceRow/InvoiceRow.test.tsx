import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { InvoiceRow } from "./InvoiceRow";

afterEach(cleanup);

const baseProps = {
  id: "in_1TTrCmAPzyroVuc5KHjKil5x",
  number: "INV-001",
  status: "paid" as const,
  amountCents: 7900,
  currency: "usd",
  // 2026-05-05 19:53:20 UTC.
  createdAt: 1_778_010_000,
  periodStart: 1_775_418_000,
  periodEnd: 1_778_010_000,
  pdfUrl: "https://files.stripe.com/v1/invoices/x.pdf",
  hostedUrl: "https://invoice.stripe.com/i/acct_x/in_1",
};

describe("InvoiceRow", () => {
  it("renders the number, status, amount, and both action links", () => {
    render(
      <ul>
        <InvoiceRow {...baseProps} />
      </ul>,
    );

    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("$79")).toBeInTheDocument();

    const download = screen.getByRole("link", { name: "Download" });
    expect(download).toHaveAttribute("href", baseProps.pdfUrl);
    expect(download).toHaveAttribute("download");

    const view = screen.getByRole("link", { name: "View" });
    expect(view).toHaveAttribute("href", baseProps.hostedUrl);
    expect(view).toHaveAttribute("target", "_blank");
  });

  it("falls back to a sliced id label when no number is set (draft invoices)", () => {
    render(
      <ul>
        <InvoiceRow {...baseProps} number={null} />
      </ul>,
    );
    // Last 8 chars of the id.
    expect(screen.getByText("Invoice KHjKil5x")).toBeInTheDocument();
  });

  it("hides the period line when start/end are missing", () => {
    const { container } = render(
      <ul>
        <InvoiceRow {...baseProps} periodStart={null} periodEnd={null} />
      </ul>,
    );
    // Period row is the only secondary muted line; assert there's exactly one
    // primary metadata line (number + date) instead of two.
    expect(container.querySelectorAll("p.text-xs").length).toBe(0);
  });

  it("formats non-whole-dollar amounts with two decimals", () => {
    render(
      <ul>
        <InvoiceRow {...baseProps} amountCents={1234} />
      </ul>,
    );
    expect(screen.getByText("$12.34")).toBeInTheDocument();
  });

  it("omits the Download link when there's no pdfUrl", () => {
    render(
      <ul>
        <InvoiceRow {...baseProps} pdfUrl={null} />
      </ul>,
    );
    expect(
      screen.queryByRole("link", { name: "Download" }),
    ).not.toBeInTheDocument();
  });

  it("omits the View link when there's no hostedUrl", () => {
    render(
      <ul>
        <InvoiceRow {...baseProps} hostedUrl={null} />
      </ul>,
    );
    expect(
      screen.queryByRole("link", { name: "View" }),
    ).not.toBeInTheDocument();
  });

  it("forwards a custom className", () => {
    const { container } = render(
      <ul>
        <InvoiceRow {...baseProps} className="custom-row" />
      </ul>,
    );
    expect(container.querySelector("li")).toHaveClass("custom-row");
  });
});
