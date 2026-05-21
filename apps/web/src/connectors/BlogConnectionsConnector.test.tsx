import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const { refreshMock, updateBlogMock, testConnectionMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  updateBlogMock: vi.fn(),
  testConnectionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/workspace", () => ({
  updateBlog: updateBlogMock,
}));

vi.mock("@/actions/wordpress-connection-test", () => ({
  testBlogWordPressConnection: testConnectionMock,
}));

import { BlogConnectionsConnector } from "./BlogConnectionsConnector";

afterEach(() => {
  cleanup();
  refreshMock.mockReset();
  updateBlogMock.mockReset();
  testConnectionMock.mockReset();
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

  it("calls the test action and renders the success panel", async () => {
    testConnectionMock.mockResolvedValue({
      data: {
        ok: true,
        siteUrl: "https://x.com",
        user: { id: 1, name: "Alice", roles: ["administrator"] },
        capabilities: {
          canCreatePosts: true,
          canPublishPosts: true,
          canUploadMedia: true,
          canCreateTerms: true,
        },
        warnings: [],
      },
      error: null,
    });
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
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => {
      expect(testConnectionMock).toHaveBeenCalledWith({
        teamId: "t1",
        projectId: "pr1",
        blogId: "b1",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Connection looks healthy")).toBeInTheDocument();
    });
  });

  it("renders the error panel when the test fails (helper-level)", async () => {
    testConnectionMock.mockResolvedValue({
      data: {
        ok: false,
        siteUrl: "https://x.com",
        warnings: [],
        error: {
          code: "unauthorized",
          message: "WordPress rejected these credentials.",
        },
      },
      error: null,
    });
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
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => {
      expect(screen.getByText("Connection failed")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/WordPress rejected these credentials/),
    ).toBeInTheDocument();
  });

  it("renders the action-level error banner when the action rejects", async () => {
    testConnectionMock.mockResolvedValue({
      data: null,
      error: "Blog not found.",
    });
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
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => {
      expect(screen.getByText("Blog not found.")).toBeInTheDocument();
    });
  });

  it("disables the Test connection button when the blog is not connected", () => {
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
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).toBeDisabled();
  });
});
