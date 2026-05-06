import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import {
  InvoiceStatusBadge,
  type InvoiceStatusValue,
} from "./InvoiceStatusBadge";

afterEach(cleanup);

describe("InvoiceStatusBadge", () => {
  it.each<[InvoiceStatusValue, string]>([
    ["paid", "Paid"],
    ["open", "Open"],
    ["void", "Void"],
    ["uncollectible", "Uncollectible"],
    ["draft", "Draft"],
    ["unknown", "Unknown"],
  ])("renders %s as '%s'", (status, label) => {
    render(<InvoiceStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("forwards a custom className", () => {
    render(<InvoiceStatusBadge status="paid" className="custom-class" />);
    expect(screen.getByText("Paid")).toHaveClass("custom-class");
  });
});
