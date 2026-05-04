import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Label } from "./Label";

afterEach(cleanup);

describe("Label", () => {
  it("renders with text", () => {
    render(<Label>Email</Label>);
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("shows required indicator", () => {
    render(<Label required>Email</Label>);
    expect(screen.getByText("*")).toBeInTheDocument();
  });
});
