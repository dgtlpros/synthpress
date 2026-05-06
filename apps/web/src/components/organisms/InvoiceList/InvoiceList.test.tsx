import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { InvoiceList, type InvoiceListItemView } from "./InvoiceList";

afterEach(cleanup);

const sampleInvoice: InvoiceListItemView = {
  id: "in_1",
  number: "INV-001",
  status: "paid",
  amountCents: 7900,
  currency: "usd",
  createdAt: 1_778_010_000,
  periodStart: 1_775_418_000,
  periodEnd: 1_778_010_000,
  pdfUrl: "https://files.stripe.com/v1/invoices/x.pdf",
  hostedUrl: "https://invoice.stripe.com/i/acct_x/in_1",
};

describe("InvoiceList", () => {
  it("renders the empty state when there are no invoices", () => {
    render(<InvoiceList invoices={[]} />);
    expect(screen.getByText("Billing history")).toBeInTheDocument();
    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
    expect(screen.getByText(/Invoices appear here/)).toBeInTheDocument();
  });

  it("renders a row per invoice when there are invoices", () => {
    render(
      <InvoiceList
        invoices={[
          sampleInvoice,
          { ...sampleInvoice, id: "in_2", number: "INV-002", amountCents: 5900 },
        ]}
      />,
    );

    expect(screen.queryByText("No invoices yet")).not.toBeInTheDocument();
    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(screen.getByText("INV-002")).toBeInTheDocument();
    expect(screen.getByText("$79")).toBeInTheDocument();
    expect(screen.getByText("$59")).toBeInTheDocument();
  });

  it("renders the footer slot when provided", () => {
    render(
      <InvoiceList
        invoices={[sampleInvoice]}
        footer={<a href="/portal">View older invoices in Stripe</a>}
      />,
    );
    expect(
      screen.getByRole("link", { name: "View older invoices in Stripe" }),
    ).toBeInTheDocument();
  });

  it("uses overridden title and empty copy when provided", () => {
    render(
      <InvoiceList
        invoices={[]}
        title="Receipts"
        emptyTitle="Nothing yet"
        emptyDescription="Subscribe to start collecting receipts."
      />,
    );
    expect(screen.getByText("Receipts")).toBeInTheDocument();
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(
      screen.getByText("Subscribe to start collecting receipts."),
    ).toBeInTheDocument();
  });

  it("forwards a custom className to the root", () => {
    render(<InvoiceList invoices={[]} className="custom-list" />);
    expect(screen.getByTestId("invoice-list")).toHaveClass("custom-list");
  });
});
