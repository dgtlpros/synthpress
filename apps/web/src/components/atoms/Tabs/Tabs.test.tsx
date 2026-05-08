import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

afterEach(cleanup);

describe("Tabs", () => {
  function renderBasic(extra?: { defaultValue?: string }) {
    return render(
      <Tabs defaultValue={extra?.defaultValue ?? "posts"}>
        <TabsList ariaLabel="Sections">
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="settings" count={3}>
            Settings
          </TabsTrigger>
          <TabsTrigger value="archived" disabled>
            Archived
          </TabsTrigger>
        </TabsList>
        <TabsContent value="posts">posts panel</TabsContent>
        <TabsContent value="settings">settings panel</TabsContent>
      </Tabs>,
    );
  }

  it("renders the default tab's panel only", () => {
    renderBasic();
    expect(screen.getByText("posts panel")).toBeInTheDocument();
    expect(screen.queryByText("settings panel")).not.toBeInTheDocument();
  });

  it("switches panels when a trigger is clicked", () => {
    renderBasic();
    fireEvent.click(screen.getByRole("tab", { name: /Settings/ }));
    expect(screen.getByText("settings panel")).toBeInTheDocument();
    expect(screen.queryByText("posts panel")).not.toBeInTheDocument();
  });

  it("supports controlled mode", () => {
    const onChange = vi.fn();
    render(
      <Tabs value="settings" onValueChange={onChange}>
        <TabsList>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="posts">posts</TabsContent>
        <TabsContent value="settings">settings</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("settings")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Posts/ }));
    expect(onChange).toHaveBeenCalledWith("posts");
    expect(screen.getByText("settings")).toBeInTheDocument();
  });

  it("supports keyboard navigation with arrows + Home/End", () => {
    renderBasic();
    const posts = screen.getByRole("tab", { name: /Posts/ });
    posts.focus();
    fireEvent.keyDown(posts, { key: "ArrowRight" });
    expect(screen.getByText("settings panel")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("tab", { name: /Settings/ }), {
      key: "ArrowLeft",
    });
    expect(screen.getByText("posts panel")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("tab", { name: /Posts/ }), {
      key: "End",
    });
    expect(screen.getByText("settings panel")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("tab", { name: /Settings/ }), {
      key: "Home",
    });
    expect(screen.getByText("posts panel")).toBeInTheDocument();
  });

  it("renders count badges on triggers", () => {
    renderBasic();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("supports vertical orientation", () => {
    render(
      <Tabs defaultValue="a" orientation="vertical">
        <TabsList ariaLabel="Sidebar tabs">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel a</TabsContent>
        <TabsContent value="b">panel b</TabsContent>
      </Tabs>,
    );
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("aria-orientation", "vertical");
    fireEvent.keyDown(screen.getByRole("tab", { name: "A" }), {
      key: "ArrowDown",
    });
    expect(screen.getByText("panel b")).toBeInTheDocument();
  });

  it("renders forceMount panels even when inactive", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel a</TabsContent>
        <TabsContent value="b" forceMount>
          panel b
        </TabsContent>
      </Tabs>,
    );
    const hidden = screen.getByText("panel b");
    expect(hidden).toBeInTheDocument();
    expect(hidden.closest("[role='tabpanel']")).toHaveAttribute("hidden");
  });

  it("throws if a piece is rendered outside Tabs", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TabsTrigger value="x">x</TabsTrigger>)).toThrow(
      /must be used inside <Tabs>/,
    );
    errSpy.mockRestore();
  });

  it("renders an icon slot when provided", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger
            value="a"
            icon={<span data-testid="tab-icon">icon</span>}
          >
            A
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel</TabsContent>
      </Tabs>,
    );
    expect(screen.getByTestId("tab-icon")).toBeInTheDocument();
  });

  it("ignores unrelated keys (no navigation, no error)", () => {
    renderBasic();
    const posts = screen.getByRole("tab", { name: /Posts/ });
    posts.focus();
    fireEvent.keyDown(posts, { key: "Tab" });
    fireEvent.keyDown(posts, { key: "Enter" });
    // Still on the Posts panel.
    expect(screen.getByText("posts panel")).toBeInTheDocument();
  });
});
