import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Badge } from "./Badge";

afterEach(cleanup);

describe("Badge", () => {
  it("renders with text", () => {
    render(<Badge>Published</Badge>);
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("renders all variants without crashing", () => {
    const variants = [
      "default",
      "success",
      "warning",
      "error",
      "brand",
    ] as const;
    variants.forEach((variant) => {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant)).toBeInTheDocument();
      unmount();
    });
  });
});
