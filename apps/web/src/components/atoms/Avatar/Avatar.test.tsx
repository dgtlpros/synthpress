import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Avatar } from "./Avatar";

afterEach(cleanup);

describe("Avatar", () => {
  it("renders fallback when no src", () => {
    render(<Avatar fallback="SP" />);
    expect(screen.getByText("SP")).toBeInTheDocument();
  });

  it("renders image when src is provided", () => {
    render(<Avatar src="/test.jpg" alt="User" fallback="U" />);
    expect(screen.getByAltText("User")).toBeInTheDocument();
  });
});
