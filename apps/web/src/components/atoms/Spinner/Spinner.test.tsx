import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Spinner } from "./Spinner";

afterEach(cleanup);

describe("Spinner", () => {
  it("renders with status role", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has accessible label", () => {
    render(<Spinner />);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });
});
