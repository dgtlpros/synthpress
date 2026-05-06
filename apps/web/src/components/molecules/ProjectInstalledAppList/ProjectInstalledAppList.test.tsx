import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { ProjectInstalledAppList } from "./ProjectInstalledAppList";

afterEach(cleanup);

const sample = [
  {
    id: "1",
    href: "/a",
    appKindLabel: "Blog",
    title: "Site",
    subtitle: "https://x.com",
    isActive: true,
  },
];

describe("ProjectInstalledAppList", () => {
  it("renders rows", () => {
    render(<ProjectInstalledAppList items={sample} />);
    expect(screen.getByRole("link", { name: /Site/i })).toHaveAttribute("href", "/a");
  });

  it("renders empty state", () => {
    render(<ProjectInstalledAppList items={[]} emptyTitle="Nothing" emptyDescription="Add one" />);
    expect(screen.getByText("Nothing")).toBeInTheDocument();
    expect(screen.getByText("Add one")).toBeInTheDocument();
  });
});
