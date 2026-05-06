import type { Meta, StoryObj } from "@storybook/react";
import { InvoiceList, type InvoiceListItemView } from "./InvoiceList";

const meta = {
  title: "Organisms/InvoiceList",
  component: InvoiceList,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof InvoiceList>;

export default meta;
type Story = StoryObj<typeof meta>;

const paid: InvoiceListItemView = {
  id: "in_paid",
  number: "INV-2026-001",
  status: "paid",
  amountCents: 7900,
  currency: "usd",
  createdAt: 1_778_010_000,
  periodStart: 1_775_418_000,
  periodEnd: 1_778_010_000,
  pdfUrl: "https://files.stripe.com/v1/invoices/x.pdf",
  hostedUrl: "https://invoice.stripe.com/i/acct_x/in_paid",
};

const open: InvoiceListItemView = {
  id: "in_open",
  number: "INV-2026-002",
  status: "open",
  amountCents: 19900,
  currency: "usd",
  createdAt: 1_778_010_000,
  periodStart: 1_778_010_000,
  periodEnd: 1_780_602_000,
  pdfUrl: "https://files.stripe.com/v1/invoices/y.pdf",
  hostedUrl: "https://invoice.stripe.com/i/acct_x/in_open",
};

export const Empty: Story = {
  args: { invoices: [] },
};

export const Single: Story = {
  args: { invoices: [paid] },
};

export const Mixed: Story = {
  args: {
    invoices: [paid, open],
    footer: (
      <span>
        Older invoices are available in the{" "}
        <a className="underline" href="#">
          Customer Portal
        </a>
        .
      </span>
    ),
  },
};
