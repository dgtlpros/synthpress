import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useWordPressPublish", () => ({
  useWordPressPublish: vi.fn(),
}));

import { useWordPressPublish } from "@/hooks/useWordPressPublish";
import { ArticleWordPressPublishConnector } from "./ArticleWordPressPublishConnector";

const mockedHook = vi.mocked(useWordPressPublish);

const send = vi.fn();
const updateDraft = vi.fn();
const publishLive = vi.fn();
const clearLink = vi.fn();
const resetError = vi.fn();

function defaultHookValue(
  overrides: Partial<ReturnType<typeof useWordPressPublish>> = {},
): ReturnType<typeof useWordPressPublish> {
  return {
    send,
    updateDraft,
    publishLive,
    clearLink,
    pendingAction: null,
    isSending: false,
    isUpdating: false,
    isPublishing: false,
    isClearing: false,
    error: null,
    errorIsRemoteMissing: false,
    lastResult: null,
    resetError,
    ...overrides,
  };
}

const baseProps = {
  teamId: "t1",
  projectId: "p1",
  blogId: "b1",
  articleId: "a1",
  hasWordPressConnection: true,
  hasBody: true,
  wpPostId: null as number | null,
  wpPostUrl: null as string | null,
  articleStatus: "ready_for_review" as const,
  featuredImageUrl: null as string | null,
  wpFeaturedMediaId: null as number | null,
  connectionsHref: "/teams/t1/projects/p1/blogs/b1/connections",
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedHook.mockReturnValue(defaultHookValue());
});

afterEach(cleanup);

describe("ArticleWordPressPublishConnector", () => {
  it("calls useWordPressPublish with the team/project/blog/article ids", () => {
    render(<ArticleWordPressPublishConnector {...baseProps} />);
    expect(mockedHook).toHaveBeenCalledWith({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      articleId: "a1",
    });
  });

  it("renders the publish card with an enabled Send button when ready", () => {
    render(<ArticleWordPressPublishConnector {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /send to wordpress draft/i }),
    ).toBeEnabled();
  });

  it("invokes send when the Send button is clicked", () => {
    render(<ArticleWordPressPublishConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /send to wordpress draft/i }),
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it("forwards isSending to the button", () => {
    mockedHook.mockReturnValue(defaultHookValue({ isSending: true }));
    render(<ArticleWordPressPublishConnector {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /send to wordpress draft/i }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("propagates the error to the card's alert", () => {
    mockedHook.mockReturnValue(
      defaultHookValue({ error: "WordPress rejected the request." }),
    );
    render(<ArticleWordPressPublishConnector {...baseProps} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /wordpress rejected the request/i,
    );
  });

  it("disables the Send button when there is no connection", () => {
    render(
      <ArticleWordPressPublishConnector
        {...baseProps}
        hasWordPressConnection={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /send to wordpress draft/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /connect wordpress/i }),
    ).toHaveAttribute("href", baseProps.connectionsHref);
  });

  it("disables the Send button when there is no body", () => {
    render(<ArticleWordPressPublishConnector {...baseProps} hasBody={false} />);
    expect(
      screen.getByRole("button", { name: /send to wordpress draft/i }),
    ).toBeDisabled();
  });

  it("renders the already-sent draft block from the persisted wp fields", () => {
    render(
      <ArticleWordPressPublishConnector
        {...baseProps}
        wpPostId={42}
        wpPostUrl="https://example.com/?p=42"
      />,
    );
    expect(
      screen.getByRole("link", { name: /view wordpress draft/i }),
    ).toHaveAttribute("href", "https://example.com/?p=42");
    expect(
      screen.getByRole("button", { name: /update wordpress draft/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /publish live to wordpress/i }),
    ).toBeEnabled();
  });

  it("forwards onUpdateDraft and onPublishLive to the hook callbacks", () => {
    const { container } = render(
      <ArticleWordPressPublishConnector
        {...baseProps}
        wpPostId={42}
        wpPostUrl="https://example.com/?p=42"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /update wordpress draft/i }),
    );
    expect(updateDraft).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", { name: /publish live to wordpress/i }),
    );
    const dialog = container.querySelector("dialog")!;
    fireEvent.click(
      dialog.querySelector("button.bg-gradient-accent")! as HTMLButtonElement,
    );
    expect(publishLive).toHaveBeenCalledOnce();
  });

  it("renders the published-live state when articleStatus is published", () => {
    render(
      <ArticleWordPressPublishConnector
        {...baseProps}
        wpPostId={99}
        wpPostUrl="https://example.com/article"
        articleStatus="published"
      />,
    );
    expect(
      screen.getByText(/Published live on WordPress \(post #99\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /update wordpress post/i }),
    ).toBeEnabled();
  });

  it("renders the remote-missing state and wires onClearLink", () => {
    mockedHook.mockReturnValue(
      defaultHookValue({
        error: "post not found",
        errorIsRemoteMissing: true,
      }),
    );
    render(
      <ArticleWordPressPublishConnector
        {...baseProps}
        wpPostId={42}
        wpPostUrl="https://example.com/?p=42"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /clear wordpress link/i }),
    );
    expect(clearLink).toHaveBeenCalledOnce();
  });

  it("forwards isUpdating / isPublishing / isClearing to the card", () => {
    mockedHook.mockReturnValue(
      defaultHookValue({ isUpdating: true, pendingAction: "update" }),
    );
    render(
      <ArticleWordPressPublishConnector
        {...baseProps}
        wpPostId={42}
        wpPostUrl="https://example.com/?p=42"
      />,
    );
    const updateBtn = screen.getByRole("button", {
      name: /update wordpress draft/i,
    });
    expect(updateBtn).toHaveAttribute("aria-busy", "true");
    expect(updateBtn).toBeDisabled();
  });

  it("prefers lastResult URL when both persisted and just-sent are present", () => {
    mockedHook.mockReturnValue(
      defaultHookValue({
        lastResult: {
          articleId: "a1",
          wpPostId: 99,
          wpPostUrl: "https://new.example.com",
        },
      }),
    );
    render(
      <ArticleWordPressPublishConnector
        {...baseProps}
        wpPostId={1}
        wpPostUrl="https://old.example.com"
      />,
    );
    expect(
      screen.getByRole("link", { name: /view wordpress draft/i }),
    ).toHaveAttribute("href", "https://new.example.com");
  });

  it("collapses missing lastResult to nulls when forwarding to the card", () => {
    mockedHook.mockReturnValue(defaultHookValue({ lastResult: null }));
    render(<ArticleWordPressPublishConnector {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /send to wordpress draft/i }),
    ).toBeEnabled();
  });
});
