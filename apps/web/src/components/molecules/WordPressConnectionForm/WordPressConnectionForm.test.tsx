import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WordPressConnectionForm } from "./WordPressConnectionForm";

afterEach(cleanup);

describe("WordPressConnectionForm", () => {
  it("renders not-connected state", () => {
    render(
      <WordPressConnectionForm
        initialUrl={null}
        initialUsername={null}
        hasStoredPassword={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("renders connected state and a disconnect button", () => {
    render(
      <WordPressConnectionForm
        initialUrl="https://example.com"
        initialUsername="alice"
        hasStoredPassword
        onSubmit={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });

  it("validates required fields", () => {
    const onSubmit = vi.fn();
    render(
      <WordPressConnectionForm
        initialUrl={null}
        initialUsername={null}
        hasStoredPassword={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(
      screen.getByText("Site URL and username are required."),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates the url format", () => {
    const onSubmit = vi.fn();
    render(
      <WordPressConnectionForm
        initialUrl={null}
        initialUsername={null}
        hasStoredPassword={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Site URL/), {
      target: { value: "not-a-url" },
    });
    fireEvent.change(screen.getByLabelText(/REST username/), {
      target: { value: "user" },
    });
    fireEvent.change(screen.getByLabelText(/Application password/), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText(/http:\/\/ or https:\/\//)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requires a password when not yet connected", () => {
    const onSubmit = vi.fn();
    render(
      <WordPressConnectionForm
        initialUrl={null}
        initialUsername={null}
        hasStoredPassword={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Site URL/), {
      target: { value: "https://x.com" },
    });
    fireEvent.change(screen.getByLabelText(/REST username/), {
      target: { value: "user" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(
      screen.getByText("Application password is required to connect."),
    ).toBeInTheDocument();
  });

  it("submits trimmed values when valid", () => {
    const onSubmit = vi.fn();
    render(
      <WordPressConnectionForm
        initialUrl={null}
        initialUsername={null}
        hasStoredPassword={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Site URL/), {
      target: { value: "  https://example.com  " },
    });
    fireEvent.change(screen.getByLabelText(/REST username/), {
      target: { value: "  alice  " },
    });
    fireEvent.change(screen.getByLabelText(/Application password/), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onSubmit).toHaveBeenCalledWith({
      wpUrl: "https://example.com",
      wpUsername: "alice",
      wpAppPassword: "secret",
    });
  });

  it("allows saving without re-typing password when one is already stored", () => {
    const onSubmit = vi.fn();
    render(
      <WordPressConnectionForm
        initialUrl="https://example.com"
        initialUsername="alice"
        hasStoredPassword
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSubmit).toHaveBeenCalledWith({
      wpUrl: "https://example.com",
      wpUsername: "alice",
      wpAppPassword: "",
    });
  });

  it("renders an external error message", () => {
    render(
      <WordPressConnectionForm
        initialUrl={null}
        initialUsername={null}
        hasStoredPassword={false}
        onSubmit={vi.fn()}
        error="Could not save."
      />,
    );
    expect(screen.getByText("Could not save.")).toBeInTheDocument();
  });

  it("calls onDisconnect when the user clicks Disconnect", () => {
    const onDisconnect = vi.fn();
    render(
      <WordPressConnectionForm
        initialUrl="https://x.com"
        initialUsername="u"
        hasStoredPassword
        onSubmit={vi.fn()}
        onDisconnect={onDisconnect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnect).toHaveBeenCalled();
  });

  describe("test-connection panel", () => {
    it("hides the panel when no onTestConnection is provided", () => {
      render(
        <WordPressConnectionForm
          initialUrl="https://x.com"
          initialUsername="u"
          hasStoredPassword
          onSubmit={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Test connection" }),
      ).not.toBeInTheDocument();
    });

    it("renders the Test connection button when onTestConnection is provided", () => {
      render(
        <WordPressConnectionForm
          initialUrl="https://x.com"
          initialUsername="u"
          hasStoredPassword
          onSubmit={vi.fn()}
          onTestConnection={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Test connection" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Test connection" }),
      ).not.toBeDisabled();
    });

    it("disables the Test connection button when there is no stored password yet", () => {
      render(
        <WordPressConnectionForm
          initialUrl={null}
          initialUsername={null}
          hasStoredPassword={false}
          onSubmit={vi.fn()}
          onTestConnection={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Test connection" }),
      ).toBeDisabled();
    });

    it("calls onTestConnection when the button is clicked", () => {
      const onTestConnection = vi.fn();
      render(
        <WordPressConnectionForm
          initialUrl="https://x.com"
          initialUsername="u"
          hasStoredPassword
          onSubmit={vi.fn()}
          onTestConnection={onTestConnection}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      expect(onTestConnection).toHaveBeenCalled();
    });

    it("shows the spinner state when isTesting is true", () => {
      render(
        <WordPressConnectionForm
          initialUrl="https://x.com"
          initialUsername="u"
          hasStoredPassword
          onSubmit={vi.fn()}
          onTestConnection={vi.fn()}
          isTesting
        />,
      );
      const button = screen.getByRole("button", { name: "Test connection" });
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(button).toBeDisabled();
    });

    it("renders a healthy success panel when the test passes with no warnings", () => {
      render(
        <WordPressConnectionForm
          initialUrl="https://x.com"
          initialUsername="u"
          hasStoredPassword
          onSubmit={vi.fn()}
          onTestConnection={vi.fn()}
          testResult={{
            ok: true,
            siteUrl: "https://x.com",
            user: {
              id: 1,
              name: "Alice Author",
              slug: "alice",
              roles: ["administrator"],
            },
            capabilities: {
              canCreatePosts: true,
              canPublishPosts: true,
              canUploadMedia: true,
              canCreateTerms: true,
            },
            warnings: [],
          }}
        />,
      );
      expect(screen.getByText("Connection looks healthy")).toBeInTheDocument();
      expect(screen.getByText(/Connected as Alice Author/)).toBeInTheDocument();
      expect(screen.getByText("administrator")).toBeInTheDocument();
      expect(
        screen.queryByTestId("wp-test-result-warnings"),
      ).not.toBeInTheDocument();
    });

    it("falls back to the generic 'REST API is reachable.' line when user has no name or slug, and hides the roles line when none are returned", () => {
      // Defensive shape: WP returned a user object with neither a
      // human-friendly name, a slug, nor any roles. The success panel
      // should still render — just without the personalized line and
      // without a "WordPress role: …" line.
      render(
        <WordPressConnectionForm
          initialUrl="https://x.com"
          initialUsername="u"
          hasStoredPassword
          onSubmit={vi.fn()}
          onTestConnection={vi.fn()}
          testResult={{
            ok: true,
            siteUrl: "https://x.com",
            user: {
              id: 1,
              // name + slug are both falsy after the .trim() chain.
              name: "   ",
              slug: "",
              roles: [],
            },
            capabilities: {
              canCreatePosts: true,
              canPublishPosts: true,
              canUploadMedia: true,
              canCreateTerms: true,
            },
            warnings: [],
          }}
        />,
      );
      expect(screen.getByText("Connection looks healthy")).toBeInTheDocument();
      // Generic copy — no "Connected as …" prefix.
      expect(screen.getByText("REST API is reachable.")).toBeInTheDocument();
      expect(screen.queryByText(/Connected as/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/WordPress role/i)).not.toBeInTheDocument();
    });

    it("pluralizes the WordPress roles line when more than one role is returned", () => {
      // Branch coverage: roles.length === 1 → "role:"; >1 → "roles:".
      render(
        <WordPressConnectionForm
          initialUrl="https://x.com"
          initialUsername="u"
          hasStoredPassword
          onSubmit={vi.fn()}
          onTestConnection={vi.fn()}
          testResult={{
            ok: true,
            siteUrl: "https://x.com",
            user: {
              id: 1,
              name: "Multi",
              slug: "multi",
              roles: ["editor", "author"],
            },
            capabilities: {
              canCreatePosts: true,
              canPublishPosts: true,
              canUploadMedia: true,
              canCreateTerms: true,
            },
            warnings: [],
          }}
        />,
      );
      expect(screen.getByText(/WordPress roles:/i)).toBeInTheDocument();
      expect(screen.getByText("editor, author")).toBeInTheDocument();
    });

    it("renders the warning panel when capabilities are limited", () => {
      render(
        <WordPressConnectionForm
          initialUrl="https://x.com"
          initialUsername="u"
          hasStoredPassword
          onSubmit={vi.fn()}
          onTestConnection={vi.fn()}
          testResult={{
            ok: true,
            siteUrl: "https://x.com",
            user: { id: 1, slug: "bob", roles: ["author"] },
            capabilities: {
              canCreatePosts: true,
              canPublishPosts: true,
              canUploadMedia: false,
              canCreateTerms: false,
            },
            warnings: [
              "Connected, but this user may not be able to upload media. Featured images won't be sent to WordPress.",
              "Connected, but this user may not be able to create new categories or tags. Use existing ones when configuring publishing defaults.",
            ],
          }}
        />,
      );
      expect(screen.getByText("Connected with warnings")).toBeInTheDocument();
      // Falls back to slug when name is missing.
      expect(screen.getByText(/Connected as bob/)).toBeInTheDocument();
      const warnings = screen.getByTestId("wp-test-result-warnings");
      expect(warnings).toHaveTextContent(/upload media/);
      expect(warnings).toHaveTextContent(/categories or tags/);
    });

    it("renders the error panel when the test fails (e.g. 401)", () => {
      render(
        <WordPressConnectionForm
          initialUrl="https://x.com"
          initialUsername="u"
          hasStoredPassword
          onSubmit={vi.fn()}
          onTestConnection={vi.fn()}
          testResult={{
            ok: false,
            siteUrl: "https://x.com",
            warnings: [],
            error: {
              code: "unauthorized",
              message: "WordPress rejected these credentials.",
            },
          }}
        />,
      );
      expect(screen.getByText("Connection failed")).toBeInTheDocument();
      expect(
        screen.getByText(/WordPress rejected these credentials/),
      ).toBeInTheDocument();
    });

    it("renders an action-level error above the result panel", () => {
      render(
        <WordPressConnectionForm
          initialUrl="https://x.com"
          initialUsername="u"
          hasStoredPassword
          onSubmit={vi.fn()}
          onTestConnection={vi.fn()}
          testActionError="Blog not found."
        />,
      );
      expect(screen.getByText("Blog not found.")).toBeInTheDocument();
    });
  });
});
