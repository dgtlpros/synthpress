import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { refreshMock, updateBlogMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  updateBlogMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/workspace", () => ({
  updateBlog: updateBlogMock,
}));

import { BlogConnectionsConnector } from "./BlogConnectionsConnector";

afterEach(() => {
  cleanup();
  refreshMock.mockReset();
  updateBlogMock.mockReset();
});

describe("BlogConnectionsConnector", () => {
  it("renders the WordPress connection form", () => {
    render(
      <BlogConnectionsConnector
        teamId="t1"
        projectId="pr1"
        blogId="b1"
        initialUrl={null}
        initialUsername={null}
        hasStoredPassword={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("calls updateBlog with the connection bundle on submit", async () => {
    updateBlogMock.mockResolvedValue({ data: null, error: null });
    render(
      <BlogConnectionsConnector
        teamId="t1"
        projectId="pr1"
        blogId="b1"
        initialUrl={null}
        initialUsername={null}
        hasStoredPassword={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Site URL/), {
      target: { value: "https://x.com" },
    });
    fireEvent.change(screen.getByLabelText(/REST username/), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText(/Application password/), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(updateBlogMock).toHaveBeenCalledWith("t1", "pr1", "b1", {
      connection: {
        wpUrl: "https://x.com",
        wpUsername: "alice",
        wpAppPassword: "secret",
      },
    });
  });

  it("calls updateBlog with nulls when disconnect is clicked", async () => {
    updateBlogMock.mockResolvedValue({ data: null, error: null });
    render(
      <BlogConnectionsConnector
        teamId="t1"
        projectId="pr1"
        blogId="b1"
        initialUrl="https://x.com"
        initialUsername="alice"
        hasStoredPassword
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(updateBlogMock).toHaveBeenCalledWith("t1", "pr1", "b1", {
      connection: { wpUrl: null, wpUsername: null, wpAppPassword: null },
    });
  });
});
