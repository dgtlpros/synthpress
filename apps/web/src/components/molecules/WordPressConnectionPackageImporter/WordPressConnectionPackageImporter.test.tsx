import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  WORDPRESS_CONNECTION_PACKAGE_KIND,
  WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION,
} from "@/lib/wordpress-connection-package";
import { WordPressConnectionPackageImporter } from "./WordPressConnectionPackageImporter";

afterEach(cleanup);

function buildPackage(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
    schemaVersion: WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION,
    exportedAt: "2026-05-21T03:32:00+00:00",
    site: {
      name: "My Blog",
      url: "https://example.com",
      restUrl: "https://example.com/wp-json/",
      wordpressVersion: "6.7",
    },
    plugin: { installed: true, version: "0.1.0" },
    recommendedUser: {
      login: "synthpress-bot",
      exists: true,
      roles: ["editor"],
    },
    readiness: [
      {
        key: "rest_api_available",
        label: "WordPress REST API reachable",
        status: "pass",
        message: "Base URL: https://example.com/wp-json/",
      },
      {
        key: "https_enabled",
        label: "HTTPS enabled",
        status: "pass",
        message: "Good",
      },
    ],
    ...overrides,
  });
}

function renderImporter(
  props: Partial<
    React.ComponentProps<typeof WordPressConnectionPackageImporter>
  > = {},
) {
  const onApply = props.onApply ?? vi.fn();
  const result = render(
    <WordPressConnectionPackageImporter
      currentUrl=""
      currentUsername=""
      onApply={onApply}
      {...props}
    />,
  );
  return { ...result, onApply };
}

describe("WordPressConnectionPackageImporter", () => {
  describe("idle phase", () => {
    it("renders the heading, helper copy, and Paste button only", () => {
      renderImporter();
      expect(
        screen.getByRole("heading", { name: /import connection package/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /paste connection package/i }),
      ).toBeInTheDocument();
      // Textarea is not in the DOM until "Paste" is clicked.
      expect(
        screen.queryByTestId("wp-import-textarea"),
      ).not.toBeInTheDocument();
    });

    it("reveals the textarea + review controls when the user clicks Paste", () => {
      renderImporter();
      fireEvent.click(
        screen.getByRole("button", { name: /paste connection package/i }),
      );
      expect(screen.getByTestId("wp-import-textarea")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /review package/i }),
      ).toBeInTheDocument();
    });

    it("disables the Paste button when the parent passes disabled", () => {
      renderImporter({ disabled: true });
      expect(
        screen.getByRole("button", { name: /paste connection package/i }),
      ).toBeDisabled();
    });
  });

  describe("review phase — successful parse", () => {
    function reveal() {
      fireEvent.click(
        screen.getByRole("button", { name: /paste connection package/i }),
      );
    }
    function paste(json: string) {
      fireEvent.change(screen.getByTestId("wp-import-textarea"), {
        target: { value: json },
      });
    }
    function review() {
      fireEvent.click(screen.getByRole("button", { name: /review package/i }));
    }

    it("renders 'Installed' for a plugin block with installed: true but no version", () => {
      // Branch coverage for the plugin-label ternary: with version
      // we render "v{version}"; without a version but with
      // installed=true we render "Installed".
      renderImporter();
      fireEvent.click(
        screen.getByRole("button", { name: /paste connection package/i }),
      );
      fireEvent.change(screen.getByTestId("wp-import-textarea"), {
        target: {
          value: buildPackage({ plugin: { installed: true } }),
        },
      });
      fireEvent.click(screen.getByRole("button", { name: /review package/i }));
      const preview = screen.getByTestId("wp-import-preview");
      expect(preview).toHaveTextContent("Installed");
      expect(preview).not.toHaveTextContent(/v0\.\d/);
    });

    it("renders site/plugin/recommended-user details and readiness rows", () => {
      renderImporter();
      reveal();
      paste(buildPackage());
      review();

      const preview = screen.getByTestId("wp-import-preview");
      expect(preview).toHaveTextContent("My Blog");
      expect(preview).toHaveTextContent("https://example.com");
      expect(preview).toHaveTextContent("https://example.com/wp-json/");
      expect(preview).toHaveTextContent("6.7");
      expect(preview).toHaveTextContent("v0.1.0");
      expect(preview).toHaveTextContent("synthpress-bot");

      const readinessRows = screen
        .getByTestId("wp-import-readiness-list")
        .querySelectorAll("li");
      expect(readinessRows).toHaveLength(2);
      expect(readinessRows[0]).toHaveTextContent(
        "WordPress REST API reachable",
      );
      expect(readinessRows[0]).toHaveTextContent("Base URL");
    });

    it("hides the readiness list section entirely when readiness is omitted", () => {
      renderImporter();
      reveal();
      paste(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION,
          site: { url: "https://example.com" },
        }),
      );
      review();
      expect(screen.queryByTestId("wp-import-readiness-list")).toBeNull();
      // No failing readiness row → no banner.
      expect(
        screen.queryByText(/may need setup changes/i),
      ).not.toBeInTheDocument();
    });

    it("renders readiness rows for each of the three statuses (pass / warning / fail)", () => {
      // Branch coverage for the dot-class switch — we need all
      // three statuses to render at least once in the suite.
      renderImporter();
      reveal();
      paste(
        buildPackage({
          readiness: [
            { key: "a", label: "Pass row", status: "pass", message: "ok" },
            {
              key: "b",
              label: "Warning row",
              status: "warning",
              message: "soft",
            },
            { key: "c", label: "Fail row", status: "fail", message: "hard" },
          ],
        }),
      );
      review();
      const list = screen.getByTestId("wp-import-readiness-list");
      const dots = list.querySelectorAll('span[role="img"]');
      expect(dots).toHaveLength(3);
      expect(dots[0]).toHaveAttribute("aria-label", "Pass");
      expect(dots[1]).toHaveAttribute("aria-label", "Warning");
      expect(dots[2]).toHaveAttribute("aria-label", "Fail");
    });

    it("surfaces the 'may need setup changes' banner when any readiness row is fail", () => {
      renderImporter();
      reveal();
      paste(
        buildPackage({
          readiness: [
            {
              key: "application_passwords_available",
              label: "Application Passwords supported",
              status: "fail",
              message: "Disabled by your host.",
            },
          ],
        }),
      );
      review();
      expect(screen.getByText(/may need setup changes/i)).toBeInTheDocument();
    });

    it("surfaces the bot-missing warning when recommendedUser.exists is false", () => {
      renderImporter();
      reveal();
      paste(
        buildPackage({
          recommendedUser: { login: "synthpress-bot", exists: false },
        }),
      );
      review();
      // The warning text is split across a <span class="font-mono">
      // and surrounding text nodes, so query by a unique substring
      // that lives on a single child and then assert the parent
      // contains the rest of the copy.
      const warningCopy = screen.getByText(/Editor-capable username/i);
      expect(warningCopy).toHaveTextContent(
        /Create\s+synthpress-bot\s+in WordPress/i,
      );
      // …and the recommended user is shown with the "(not found)" hint.
      expect(
        screen.getByText(/synthpress-bot \(not found in WordPress\)/i),
      ).toBeInTheDocument();
    });

    it("does NOT show the bot-missing warning when recommendedUser is omitted (no signal either way)", () => {
      renderImporter();
      reveal();
      paste(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION,
          site: { url: "https://example.com" },
        }),
      );
      review();
      expect(
        screen.queryByText(/Editor-capable username/i),
      ).not.toBeInTheDocument();
    });

    it("propagates parser warnings (e.g. credential fields stripped)", () => {
      renderImporter();
      reveal();
      paste(
        buildPackage({
          wp_app_password: "shhh",
        }),
      );
      review();
      const warnings = screen.getByTestId("wp-import-warnings");
      expect(warnings).toHaveTextContent(/credentials/i);
    });
  });

  describe("apply (Use this connection)", () => {
    function setupAndReview(currentUrl = "", currentUsername = "") {
      const onApply = vi.fn();
      render(
        <WordPressConnectionPackageImporter
          currentUrl={currentUrl}
          currentUsername={currentUsername}
          onApply={onApply}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /paste connection package/i }),
      );
      fireEvent.change(screen.getByTestId("wp-import-textarea"), {
        target: { value: buildPackage() },
      });
      fireEvent.click(screen.getByRole("button", { name: /review package/i }));
      return onApply;
    }

    it("calls onApply with site URL + bot login, then returns to idle", () => {
      const onApply = setupAndReview();
      fireEvent.click(
        screen.getByRole("button", { name: /use this connection/i }),
      );
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith({
        wpUrl: "https://example.com",
        wpUsername: "synthpress-bot",
      });
      // Back to idle → textarea is gone again.
      expect(
        screen.queryByTestId("wp-import-textarea"),
      ).not.toBeInTheDocument();
    });

    it("omits wpUsername when the recommended user does NOT exist in WordPress", () => {
      const onApply = vi.fn();
      render(
        <WordPressConnectionPackageImporter
          currentUrl=""
          currentUsername=""
          onApply={onApply}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /paste connection package/i }),
      );
      fireEvent.change(screen.getByTestId("wp-import-textarea"), {
        target: {
          value: buildPackage({
            recommendedUser: { login: "synthpress-bot", exists: false },
          }),
        },
      });
      fireEvent.click(screen.getByRole("button", { name: /review package/i }));
      fireEvent.click(
        screen.getByRole("button", { name: /use this connection/i }),
      );
      expect(onApply).toHaveBeenCalledWith({
        wpUrl: "https://example.com",
        wpUsername: undefined,
      });
    });

    it("never includes anything resembling an Application Password in the apply payload", () => {
      const onApply = vi.fn();
      render(
        <WordPressConnectionPackageImporter
          currentUrl=""
          currentUsername=""
          onApply={onApply}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /paste connection package/i }),
      );
      fireEvent.change(screen.getByTestId("wp-import-textarea"), {
        target: {
          value: buildPackage({ wp_app_password: "should-be-ignored" }),
        },
      });
      fireEvent.click(screen.getByRole("button", { name: /review package/i }));
      fireEvent.click(
        screen.getByRole("button", { name: /use this connection/i }),
      );
      expect(onApply).toHaveBeenCalledTimes(1);
      const payload = onApply.mock.calls[0]?.[0];
      expect(payload).toBeDefined();
      const serialised = JSON.stringify(payload);
      expect(serialised).not.toMatch(/should-be-ignored/);
      // The apply payload only ever contains wpUrl + wpUsername.
      expect(Object.keys(payload).sort()).toEqual(["wpUrl", "wpUsername"]);
    });

    it("shows the overwrite-URL notice when the form already has a different URL", () => {
      setupAndReview("https://other.example", "");
      expect(
        screen.getByText(/will overwrite the URL already in the form/i),
      ).toBeInTheDocument();
    });

    it("shows the overwrite-username notice when the form already has a different username", () => {
      setupAndReview("", "alice");
      expect(
        screen.getByText(/will overwrite the username already in the form/i),
      ).toBeInTheDocument();
    });

    it("shows the combined overwrite notice when both URL and username differ", () => {
      setupAndReview("https://other.example", "alice");
      expect(
        screen.getByText(/will overwrite the URL and username/i),
      ).toBeInTheDocument();
    });

    it("does NOT show any overwrite notice when current values match the package", () => {
      setupAndReview("https://example.com", "synthpress-bot");
      expect(screen.queryByText(/will overwrite/i)).not.toBeInTheDocument();
    });

    it("Cancel button returns the importer to idle without calling onApply", () => {
      const onApply = setupAndReview();
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(onApply).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("wp-import-textarea"),
      ).not.toBeInTheDocument();
    });

    it("apply is a no-op when called before review() (guards against stale onClick handlers)", () => {
      const onApply = vi.fn();
      // Render directly with mocked onApply; we never click Review,
      // so the button isn't even rendered — covers the early-return
      // safety net inside the apply() function for callers that
      // wire onClick before the component reaches `reviewing`.
      render(
        <WordPressConnectionPackageImporter
          currentUrl=""
          currentUsername=""
          onApply={onApply}
        />,
      );
      // No "Use this connection" button is mounted in idle.
      expect(
        screen.queryByRole("button", { name: /use this connection/i }),
      ).not.toBeInTheDocument();
      expect(onApply).not.toHaveBeenCalled();
    });
  });

  describe("error phase", () => {
    function pasteAndReview(json: string) {
      fireEvent.click(
        screen.getByRole("button", { name: /paste connection package/i }),
      );
      fireEvent.change(screen.getByTestId("wp-import-textarea"), {
        target: { value: json },
      });
      fireEvent.click(screen.getByRole("button", { name: /review package/i }));
    }

    it("renders the parser error message inline", () => {
      renderImporter();
      pasteAndReview("{ not: json }");
      expect(screen.getByRole("alert")).toHaveTextContent(/could not parse/i);
    });

    it("shows the empty-input error when Review is clicked with no JSON", () => {
      renderImporter();
      fireEvent.click(
        screen.getByRole("button", { name: /paste connection package/i }),
      );
      fireEvent.click(screen.getByRole("button", { name: /review package/i }));
      expect(screen.getByRole("alert")).toHaveTextContent(/paste/i);
    });

    it("clears the error and switches back to editing when the user edits the JSON", () => {
      renderImporter();
      pasteAndReview("not json");
      expect(screen.getByRole("alert")).toBeInTheDocument();
      fireEvent.change(screen.getByTestId("wp-import-textarea"), {
        target: { value: buildPackage() },
      });
      // Error cleared.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      // Review again succeeds.
      fireEvent.click(screen.getByRole("button", { name: /review package/i }));
      expect(screen.getByTestId("wp-import-preview")).toBeInTheDocument();
    });

    it("Cancel from error returns to idle", () => {
      renderImporter();
      pasteAndReview("not json");
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(
        screen.queryByTestId("wp-import-textarea"),
      ).not.toBeInTheDocument();
    });
  });

  describe("re-arming after review", () => {
    it("editing JSON after a successful review forces another Review click before apply", () => {
      const onApply = vi.fn();
      render(
        <WordPressConnectionPackageImporter
          currentUrl=""
          currentUsername=""
          onApply={onApply}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /paste connection package/i }),
      );
      fireEvent.change(screen.getByTestId("wp-import-textarea"), {
        target: { value: buildPackage() },
      });
      fireEvent.click(screen.getByRole("button", { name: /review package/i }));
      expect(screen.getByTestId("wp-import-preview")).toBeInTheDocument();
      // User keeps editing → preview should disappear; the apply
      // button shouldn't be available anymore.
      fireEvent.change(screen.getByTestId("wp-import-textarea"), {
        target: {
          value: buildPackage({ site: { url: "https://other.example" } }),
        },
      });
      expect(screen.queryByTestId("wp-import-preview")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use this connection/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /review package/i }),
      ).toBeInTheDocument();
    });
  });
});
