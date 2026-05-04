import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Text } from "./Text";

afterEach(cleanup);

describe("Text", () => {
  it("renders with correct text", () => {
    render(<Text>Hello world</Text>);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders h1 as an h1 element", () => {
    render(<Text variant="h1">Heading</Text>);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders h3 as an h3 element", () => {
    render(<Text variant="h3">Subheading</Text>);
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
  });

  it("allows custom element via as prop", () => {
    render(<Text as="label">Label text</Text>);
    expect(screen.getByText("Label text").tagName).toBe("LABEL");
  });
});
