import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WordPressPublishCard } from "./WordPressPublishCard";

// jsdom doesn't implement <dialog> — polyfill so ConfirmModal's
// useEffect doesn't blow up on render.
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

const baseProps = {
  hasConnection: true,
  hasBody: true,
  wpPostId: null as number | null,
  wpPostUrl: null as string | null,
  articleStatus: "ready_for_review" as const,
  connectionsHref: "/teams/t1/projects/p1/blogs/b1/connections",
};

afterEach(cleanup);

describe("WordPressPublishCard — connected, ready (no wp_post_id)", () => {
  it("renders the connected state with an enabled Send button", () => {
    render(<WordPressPublishCard {...baseProps} />);
    const button = screen.getByRole("button", {
      name: /send to wordpress draft/i,
    });
    expect(button).toBeEnabled();
    expect(screen.getByText(/^Connected$/)).toBeInTheDocument();
    expect(
      screen.getByText(/convert the Markdown body to HTML/i),
    ).toBeInTheDocument();
  });

  it("calls onSend when the Send button is clicked", () => {
    const onSend = vi.fn();
    render(<WordPressPublishCard {...baseProps} onSend={onSend} />);
    fireEvent.click(
      screen.getByRole("button", { name: /send to wordpress draft/i }),
    );
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("forwards isSending to the button (loading + aria-busy)", () => {
    render(<WordPressPublishCard {...baseProps} isSending />);
    const button = screen.getByRole("button", {
      name: /send to wordpress draft/i,
    });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
  });

  it("renders the error message in an alert region", () => {
    render(
      <WordPressPublishCard
        {...baseProps}
        errorMessage="WordPress rejected the request."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /wordpress rejected the request/i,
    );
  });

  it("does not show the Update Draft / Publish Live buttons in this state", () => {
    render(<WordPressPublishCard {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /update wordpress draft/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /publish live to wordpress/i }),
    ).not.toBeInTheDocument();
  });

  it("forwards a custom className to the root Card", () => {
    const { container } = render(
      <WordPressPublishCard {...baseProps} className="custom-cls" />,
    );
    expect(container.firstChild).toHaveClass("custom-cls");
  });
});

describe("WordPressPublishCard — not connected", () => {
  it("disables the Send button and shows the Connect link", () => {
    render(<WordPressPublishCard {...baseProps} hasConnection={false} />);
    const button = screen.getByRole("button", {
      name: /send to wordpress draft/i,
    });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Not connected/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /connect wordpress/i });
    expect(link).toHaveAttribute("href", baseProps.connectionsHref);
    expect(button).toHaveAttribute(
      "aria-describedby",
      "wp-send-disabled-reason",
    );
  });

  it("does not call onSend when disabled", () => {
    const onSend = vi.fn();
    render(
      <WordPressPublishCard
        {...baseProps}
        hasConnection={false}
        onSend={onSend}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /send to wordpress draft/i }),
    );
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("WordPressPublishCard — no body", () => {
  it("disables the Send button and shows the body hint", () => {
    render(<WordPressPublishCard {...baseProps} hasBody={false} />);
    const button = screen.getByRole("button", {
      name: /send to wordpress draft/i,
    });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/article has no Markdown content yet/i),
    ).toBeInTheDocument();
    expect(button).toHaveAttribute(
      "aria-describedby",
      "wp-send-disabled-reason",
    );
  });
});

describe("WordPressPublishCard — already sent as draft", () => {
  const sentProps = {
    ...baseProps,
    wpPostId: 42,
    wpPostUrl: "https://example.com/?p=42",
  };

  it("shows the draft success block + View link", () => {
    render(<WordPressPublishCard {...sentProps} />);
    expect(
      screen.getByText(/Draft created in WordPress \(post #42\)/i),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view wordpress draft/i });
    expect(link).toHaveAttribute("href", "https://example.com/?p=42");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders Update WordPress Draft + Publish Live buttons", () => {
    render(<WordPressPublishCard {...sentProps} />);
    expect(
      screen.getByRole("button", { name: /update wordpress draft/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /publish live to wordpress/i }),
    ).toBeEnabled();
  });

  it("calls onUpdateDraft when Update WordPress Draft is clicked", () => {
    const onUpdateDraft = vi.fn();
    render(
      <WordPressPublishCard {...sentProps} onUpdateDraft={onUpdateDraft} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /update wordpress draft/i }),
    );
    expect(onUpdateDraft).toHaveBeenCalledOnce();
  });

  it("opens the publish-live confirmation modal before firing onPublishLive", () => {
    const onPublishLive = vi.fn();
    const { container } = render(
      <WordPressPublishCard {...sentProps} onPublishLive={onPublishLive} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /publish live to wordpress/i }),
    );
    expect(onPublishLive).not.toHaveBeenCalled();
    expect(container.querySelector("dialog[open]")).not.toBeNull();
    expect(
      screen.getByText(
        /Publish this article live on WordPress\? This will make the post publicly visible\./i,
      ),
    ).toBeInTheDocument();

    // The modal's confirm button is inside the <dialog>; scope the
    // query so we don't also match the trigger button outside.
    const dialog = container.querySelector("dialog")!;
    fireEvent.click(
      dialog.querySelector("button.bg-gradient-accent")! as HTMLButtonElement,
    );
    expect(onPublishLive).toHaveBeenCalledOnce();
  });

  it("cancels the publish-live confirmation without firing onPublishLive", () => {
    const onPublishLive = vi.fn();
    const { container } = render(
      <WordPressPublishCard {...sentProps} onPublishLive={onPublishLive} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /publish live to wordpress/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(container.querySelector("dialog[open]")).toBeNull();
    expect(onPublishLive).not.toHaveBeenCalled();
  });

  it("disables BOTH action buttons while update is in flight", () => {
    render(<WordPressPublishCard {...sentProps} isUpdating />);
    expect(
      screen.getByRole("button", { name: /update wordpress draft/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /publish live to wordpress/i }),
    ).toBeDisabled();
  });

  it("disables BOTH action buttons while publish is in flight", () => {
    render(<WordPressPublishCard {...sentProps} isPublishing />);
    expect(
      screen.getByRole("button", { name: /update wordpress draft/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /publish live to wordpress/i }),
    ).toBeDisabled();
  });

  it("disables Update + Publish when the body has been emptied", () => {
    render(<WordPressPublishCard {...sentProps} hasBody={false} />);
    expect(
      screen.getByRole("button", { name: /update wordpress draft/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /publish live to wordpress/i }),
    ).toBeDisabled();
  });

  it("hides the View link when no wpPostUrl is available", () => {
    render(<WordPressPublishCard {...sentProps} wpPostUrl={null} />);
    expect(
      screen.queryByRole("link", { name: /view wordpress draft/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Draft created in WordPress \(post #42\)/i),
    ).toBeInTheDocument();
  });

  it("prefers justSentPostId/Url over the persisted wp fields", () => {
    render(
      <WordPressPublishCard
        {...baseProps}
        wpPostId={1}
        wpPostUrl="https://old.example.com"
        justSentPostId={2}
        justSentPostUrl="https://new.example.com"
      />,
    );
    const link = screen.getByRole("link", { name: /view wordpress draft/i });
    expect(link).toHaveAttribute("href", "https://new.example.com");
    expect(
      screen.getByText(/Draft created in WordPress \(post #2\)/i),
    ).toBeInTheDocument();
  });

  it("uses a status role for the success block", () => {
    render(<WordPressPublishCard {...sentProps} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Draft created/i);
  });

  it("renders error messages alongside the draft block", () => {
    render(
      <WordPressPublishCard
        {...sentProps}
        errorMessage="WordPress rejected the update."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /wordpress rejected the update/i,
    );
  });

  it("disables the Publish Live trigger while another action is in flight", () => {
    render(<WordPressPublishCard {...sentProps} isUpdating />);
    expect(
      screen.getByRole("button", { name: /publish live to wordpress/i }),
    ).toBeDisabled();
  });
});

describe("WordPressPublishCard — published live", () => {
  const liveProps = {
    ...baseProps,
    wpPostId: 99,
    wpPostUrl: "https://example.com/article",
    articleStatus: "published" as const,
  };

  it("renders the Published status badge + Published live success block", () => {
    render(<WordPressPublishCard {...liveProps} />);
    expect(screen.getByText(/^Published$/)).toBeInTheDocument();
    expect(
      screen.getByText(/Published live on WordPress \(post #99\)/i),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view wordpress post/i });
    expect(link).toHaveAttribute("href", "https://example.com/article");
  });

  it("hides the Send button and shows Update WordPress Post (publish-live action)", () => {
    render(<WordPressPublishCard {...liveProps} />);
    expect(
      screen.queryByRole("button", { name: /send to wordpress draft/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /update wordpress draft/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /update wordpress post/i }),
    ).toBeEnabled();
  });

  it("opens the update-live confirmation modal with the 'update live' wording", () => {
    const onPublishLive = vi.fn();
    const { container } = render(
      <WordPressPublishCard {...liveProps} onPublishLive={onPublishLive} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /update wordpress post/i }),
    );
    expect(container.querySelector("dialog[open]")).not.toBeNull();
    expect(
      screen.getByText(/Visitors will see the new version immediately/i),
    ).toBeInTheDocument();

    const dialog = container.querySelector("dialog")!;
    fireEvent.click(
      dialog.querySelector("button.bg-gradient-accent")! as HTMLButtonElement,
    );
    expect(onPublishLive).toHaveBeenCalledOnce();
  });

  it("hides the View link when no wpPostUrl is available", () => {
    render(<WordPressPublishCard {...liveProps} wpPostUrl={null} />);
    expect(
      screen.queryByRole("link", { name: /view wordpress post/i }),
    ).not.toBeInTheDocument();
  });
});

describe("WordPressPublishCard — remote draft missing", () => {
  const missingProps = {
    ...baseProps,
    wpPostId: 42,
    wpPostUrl: "https://example.com/?p=42",
    errorIsRemoteMissing: true,
    errorMessage:
      "The WordPress post could not be found. It may have been deleted in WordPress. Clear the link and send again as a new draft.",
  };

  it("renders the friendly remote-missing alert and the Clear button", () => {
    render(<WordPressPublishCard {...missingProps} />);
    expect(screen.getByText(/^Draft missing$/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/post not found/i);
    expect(
      screen.getByRole("button", { name: /clear wordpress link/i }),
    ).toBeEnabled();
  });

  it("calls onClearLink when the Clear button is clicked", () => {
    const onClearLink = vi.fn();
    render(
      <WordPressPublishCard {...missingProps} onClearLink={onClearLink} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /clear wordpress link/i }),
    );
    expect(onClearLink).toHaveBeenCalledOnce();
  });

  it("does NOT render a separate inline error region (the remote-missing block IS the alert)", () => {
    render(<WordPressPublishCard {...missingProps} />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("hides the Update / Publish buttons in this state", () => {
    render(<WordPressPublishCard {...missingProps} />);
    expect(
      screen.queryByRole("button", { name: /update wordpress draft/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /publish live to wordpress/i }),
    ).not.toBeInTheDocument();
  });

  it("forwards isClearing to the Clear button", () => {
    render(<WordPressPublishCard {...missingProps} isClearing />);
    const button = screen.getByRole("button", {
      name: /clear wordpress link/i,
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("does NOT switch into remote-missing when wpPostId is null (no link to clear)", () => {
    render(
      <WordPressPublishCard
        {...baseProps}
        wpPostId={null}
        errorIsRemoteMissing
        errorMessage="oops"
      />,
    );
    expect(
      screen.queryByRole("button", { name: /clear wordpress link/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send to wordpress draft/i }),
    ).toBeEnabled();
  });
});

describe("WordPressPublishCard — featured image status line", () => {
  it("hides the status line when there is no featured image URL", () => {
    render(<WordPressPublishCard {...baseProps} />);
    expect(
      screen.queryByTestId("wp-featured-image-status"),
    ).not.toBeInTheDocument();
  });

  it("shows the 'will upload on next sync' line when wpFeaturedMediaId is null", () => {
    render(
      <WordPressPublishCard
        {...baseProps}
        featuredImageUrl="https://example.com/img.jpg"
        wpFeaturedMediaId={null}
      />,
    );
    const node = screen.getByTestId("wp-featured-image-status");
    expect(node).toHaveTextContent(
      /Featured image will be uploaded to WordPress on the next sync\./i,
    );
  });

  it("shows the 'uploaded to WordPress' line when wpFeaturedMediaId is set", () => {
    render(
      <WordPressPublishCard
        {...baseProps}
        featuredImageUrl="https://example.com/img.jpg"
        wpFeaturedMediaId={99}
      />,
    );
    const node = screen.getByTestId("wp-featured-image-status");
    expect(node).toHaveTextContent(/Featured image uploaded to WordPress\./i);
  });

  it("hides the status line when only wpFeaturedMediaId is set without a URL (defensive)", () => {
    render(
      <WordPressPublishCard
        {...baseProps}
        featuredImageUrl={null}
        wpFeaturedMediaId={99}
      />,
    );
    expect(
      screen.queryByTestId("wp-featured-image-status"),
    ).not.toBeInTheDocument();
  });
});
