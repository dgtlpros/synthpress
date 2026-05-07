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
});
