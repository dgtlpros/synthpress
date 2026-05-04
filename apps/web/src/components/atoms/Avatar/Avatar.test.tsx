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

  it("uses fallback as alt when alt is not provided with src", () => {
    render(<Avatar src="/test.jpg" fallback="SP" />);
    expect(screen.getByAltText("SP")).toBeInTheDocument();
  });

  it("uses fallback as aria-label when alt is not provided without src", () => {
    render(<Avatar fallback="AB" />);
    expect(screen.getByLabelText("AB")).toBeInTheDocument();
  });

  it("renders all sizes", () => {
    const sizes = ["sm", "md", "lg"] as const;
    sizes.forEach((size) => {
      const { unmount } = render(<Avatar fallback="X" size={size} />);
      expect(screen.getByText("X")).toBeInTheDocument();
      unmount();
    });
  });
});
