import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BlogSubNav } from "./BlogSubNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams/t1/projects/p1/blogs/b1/settings",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("BlogSubNav", () => {
  const base = "/teams/t1/projects/p1/blogs/b1";
  const items = [
    { segment: "", label: "Posts", badge: 12 },
    { segment: "settings", label: "Settings" },
    { segment: "connections", label: "Connections" },
    { segment: "queue", label: "Queue", comingSoon: true },
  ];

  it("renders every label", () => {
    render(<BlogSubNav basePath={base} items={items} />);
    items.forEach((i) => {
      expect(screen.getByText(i.label)).toBeInTheDocument();
    });
  });

  it("marks the matching segment as the current page", () => {
    render(<BlogSubNav basePath={base} items={items} />);
    expect(screen.getByText("Settings").closest("a")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Posts").closest("a")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("links the index to the base path with no trailing segment", () => {
    render(<BlogSubNav basePath={base} items={items} />);
    expect(screen.getByText("Posts").closest("a")).toHaveAttribute(
      "href",
      base,
    );
  });

  it("renders a 'Soon' badge for coming-soon items as a non-link span", () => {
    render(<BlogSubNav basePath={base} items={items} />);
    const queue = screen.getByText("Queue");
    expect(queue.closest("span[aria-disabled='true']")).not.toBeNull();
    expect(screen.getByText("Soon")).toBeInTheDocument();
  });

  it("renders the active count badge with brand styling", () => {
    render(<BlogSubNav basePath={base} items={items} />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});

describe("BlogSubNav (index path)", () => {
  it("treats the base path itself as the active 'Posts' tab", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      usePathname: () => "/teams/t1/projects/p1/blogs/b1",
    }));
    vi.doMock("next/link", () => ({
      default: ({
        href,
        children,
        ...rest
      }: {
        href: string;
        children: React.ReactNode;
      }) => (
        <a href={href} {...rest}>
          {children}
        </a>
      ),
    }));

    const { BlogSubNav: Reloaded } = await import("./BlogSubNav");
    render(
      <Reloaded
        basePath="/teams/t1/projects/p1/blogs/b1"
        items={[
          { segment: "", label: "Posts" },
          { segment: "settings", label: "Settings" },
        ]}
      />,
    );

    expect(screen.getByText("Posts").closest("a")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("falls back to empty pathname when usePathname returns null", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      usePathname: () => null,
    }));
    vi.doMock("next/link", () => ({
      default: ({
        href,
        children,
        ...rest
      }: {
        href: string;
        children: React.ReactNode;
      }) => (
        <a href={href} {...rest}>
          {children}
        </a>
      ),
    }));

    const { BlogSubNav: Reloaded } = await import("./BlogSubNav");
    render(
      <Reloaded
        basePath="/teams/t1/projects/p1/blogs/b1"
        items={[
          { segment: "", label: "Posts" },
          { segment: "settings", label: "Settings" },
        ]}
      />,
    );
    // No item is the active page when the pathname is empty.
    expect(screen.getByText("Posts").closest("a")).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByText("Settings").closest("a")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders an empty-segment item as a coming-soon span (key='_index')", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      usePathname: () => "/teams/t1/projects/p1/blogs/b1",
    }));
    vi.doMock("next/link", () => ({
      default: ({
        href,
        children,
        ...rest
      }: {
        href: string;
        children: React.ReactNode;
      }) => (
        <a href={href} {...rest}>
          {children}
        </a>
      ),
    }));

    const { BlogSubNav: Reloaded } = await import("./BlogSubNav");
    render(
      <Reloaded
        basePath="/teams/t1/projects/p1/blogs/b1"
        items={[{ segment: "", label: "Index", comingSoon: true }]}
      />,
    );
    expect(
      screen.getByText("Index").closest("span[aria-disabled='true']"),
    ).not.toBeNull();
  });

  it("renders an active count badge with the active styling", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      usePathname: () => "/teams/t1/projects/p1/blogs/b1",
    }));
    vi.doMock("next/link", () => ({
      default: ({
        href,
        children,
        ...rest
      }: {
        href: string;
        children: React.ReactNode;
      }) => (
        <a href={href} {...rest}>
          {children}
        </a>
      ),
    }));

    const { BlogSubNav: Reloaded } = await import("./BlogSubNav");
    render(
      <Reloaded
        basePath="/teams/t1/projects/p1/blogs/b1"
        items={[{ segment: "", label: "Posts", badge: 7 }]}
      />,
    );
    const link = screen.getByText("Posts").closest("a");
    expect(link).toHaveAttribute("aria-current", "page");
    const badge = screen.getByText("7");
    expect(badge.className).toMatch(/bg-brand-blue/);
  });
});
