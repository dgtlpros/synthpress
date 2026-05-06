import type { Meta, StoryObj } from "@storybook/react";
import { InvoiceRow } from "./InvoiceRow";

const meta = {
  title: "Molecules/InvoiceRow",
  component: InvoiceRow,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  // Wrap in a ul so the row's semantic <li> is valid in isolation.
  decorators: [
    (Story) => (
      <ul className="rounded-[var(--sp-radius-xl)] border border-border bg-surface">
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof InvoiceRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PaidProMonthly: Story = {
  args: {
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
  },
};

export const PaidScaleAnnual: Story = {
  args: {
    id: "in_annual",
    number: "INV-2026-002",
    status: "paid",
    amountCents: 199000,
    currency: "usd",
    createdAt: 1_778_010_000,
    periodStart: 1_778_010_000,
    periodEnd: 1_809_546_000,
    pdfUrl: "https://files.stripe.com/v1/invoices/y.pdf",
    hostedUrl: "https://invoice.stripe.com/i/acct_x/in_annual",
  },
};

export const Open: Story = {
  args: {
    id: "in_open",
    number: "INV-2026-003",
    status: "open",
    amountCents: 7900,
    currency: "usd",
    createdAt: 1_778_010_000,
    periodStart: 1_775_418_000,
    periodEnd: 1_778_010_000,
    pdfUrl: "https://files.stripe.com/v1/invoices/x.pdf",
    hostedUrl: "https://invoice.stripe.com/i/acct_x/in_open",
  },
};

export const DraftWithNoNumber: Story = {
  args: {
    id: "in_draft_abcdef12",
    number: null,
    status: "draft",
    amountCents: 0,
    currency: "usd",
    createdAt: 1_778_010_000,
    periodStart: null,
    periodEnd: null,
    pdfUrl: null,
    hostedUrl: null,
  },
};
