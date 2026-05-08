import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { pushMock, refreshMock, createPostMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  createPostMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/actions/workspace", () => ({
  createPost: createPostMock,
}));

import { BlogPostsConnector } from "./BlogPostsConnector";
import type { PostsDashboardPost } from "@/components/organisms/PostsDashboard";

afterEach(() => {
  cleanup();
  pushMock.mockReset();
  refreshMock.mockReset();
  createPostMock.mockReset();
});

const post: PostsDashboardPost = {
  id: "p1",
  title: "Hello",
  status: "draft",
  excerpt: null,
  targetKeyword: null,
  authorPersona: null,
  wordCount: null,
  generatedByModel: null,
  scheduledAt: null,
  publishedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  destinationLabel: null,
};

describe("BlogPostsConnector", () => {
  it("renders the posts dashboard with initial posts", () => {
    render(
      <BlogPostsConnector
        teamId="t1"
        projectId="pr1"
        blogId="b1"
        initialPosts={[post]}
      />,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("routes to a post page when a row is clicked", () => {
    render(
      <BlogPostsConnector
        teamId="t1"
        projectId="pr1"
        blogId="b1"
        initialPosts={[post]}
      />,
    );
    fireEvent.click(screen.getByText("Hello"));
    expect(pushMock).toHaveBeenCalledWith(
      "/teams/t1/projects/pr1/blogs/b1/posts/p1",
    );
  });

  it("links to the Ideas tab from the empty state and the bottom toolbar", () => {
    render(
      <BlogPostsConnector
        teamId="t1"
        projectId="pr1"
        blogId="b1"
        initialPosts={[]}
      />,
    );
    const ideasLink = screen.getByRole("link", { name: /go to ideas/i });
    expect(ideasLink).toHaveAttribute(
      "href",
      "/teams/t1/projects/pr1/blogs/b1/ideas",
    );
  });

  it("renders the bottom 'Generate from an idea' link when posts exist", () => {
    render(
      <BlogPostsConnector
        teamId="t1"
        projectId="pr1"
        blogId="b1"
        initialPosts={[post]}
      />,
    );
    const link = screen.getByRole("link", { name: /generate from an idea/i });
    expect(link).toHaveAttribute(
      "href",
      "/teams/t1/projects/pr1/blogs/b1/ideas",
    );
  });

  it("surfaces a create-post error in an alert", async () => {
    createPostMock.mockResolvedValue({
      data: null,
      error: "Title too long.",
    });
    render(
      <BlogPostsConnector
        teamId="t1"
        projectId="pr1"
        blogId="b1"
        initialPosts={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New post" }));
    fireEvent.change(screen.getByLabelText("New post title"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    // Wait a tick for the transition to finish.
    await new Promise((r) => setTimeout(r, 0));
    expect(await screen.findByText("Title too long.")).toBeInTheDocument();
  });
});
