import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";
import {
  BLOG_SETTINGS_TEMPLATE_KIND,
  BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
  buildBlogSettingsTemplate,
  serializeBlogSettingsTemplate,
} from "@/lib/blog-settings-template";

const { refreshMock, importMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  importMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/blog-settings-template", () => ({
  importBlogSettingsTemplate: importMock,
}));

import { BlogSettingsImportExportConnector } from "./BlogSettingsImportExportConnector";

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

afterEach(() => {
  cleanup();
  refreshMock.mockReset();
  importMock.mockReset();
});

const sampleTemplate = buildBlogSettingsTemplate({
  blog: { name: "Indie" },
  settings: DEFAULT_BLOG_SETTINGS,
  exportedAt: "2026-05-20T18:00:00.000Z",
});
const sampleJson = serializeBlogSettingsTemplate(sampleTemplate);

describe("BlogSettingsImportExportConnector", () => {
  it("renders both action buttons", () => {
    render(
      <BlogSettingsImportExportConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        exportTemplateJson={sampleJson}
        current={{
          blog: { name: "Indie" },
          settings: DEFAULT_BLOG_SETTINGS,
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Export settings JSON" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import settings JSON" }),
    ).toBeInTheDocument();
  });

  it("opens the import modal, validates JSON, and applies via the server action", async () => {
    importMock.mockResolvedValue({ data: { warnings: [] }, error: null });
    render(
      <BlogSettingsImportExportConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        exportTemplateJson={sampleJson}
        current={{
          blog: { name: "Indie" },
          settings: DEFAULT_BLOG_SETTINGS,
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Import settings JSON" }),
    );
    fireEvent.change(screen.getByLabelText(/Paste template JSON/), {
      target: { value: sampleJson },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));

    // Reviewing state — assert the kind callout exists in the badge area.
    expect(screen.getByText(/schemaVersion 1/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply settings" }));

    await new Promise((r) => setTimeout(r, 0));

    expect(importMock).toHaveBeenCalledWith({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      templateJson: sampleJson,
      options: { includeBlogIdentity: false, includeAutomation: true },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a parse error and never calls the server action", async () => {
    render(
      <BlogSettingsImportExportConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        exportTemplateJson={sampleJson}
        current={{
          blog: { name: "Indie" },
          settings: DEFAULT_BLOG_SETTINGS,
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Import settings JSON" }),
    );
    fireEvent.change(screen.getByLabelText(/Paste template JSON/), {
      target: { value: "{ malformed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Could not parse JSON/,
    );
    expect(importMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong-kind template at the validation step", async () => {
    render(
      <BlogSettingsImportExportConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        exportTemplateJson={sampleJson}
        current={{
          blog: { name: "Indie" },
          settings: DEFAULT_BLOG_SETTINGS,
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Import settings JSON" }),
    );
    const wrongKindJson = JSON.stringify({
      kind: "not.synthpress",
      schemaVersion: BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
      settings: DEFAULT_BLOG_SETTINGS,
    });
    fireEvent.change(screen.getByLabelText(/Paste template JSON/), {
      target: { value: wrongKindJson },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Unrecognized template kind/,
    );
    expect(importMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported schemaVersion at the validation step", async () => {
    render(
      <BlogSettingsImportExportConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        exportTemplateJson={sampleJson}
        current={{
          blog: { name: "Indie" },
          settings: DEFAULT_BLOG_SETTINGS,
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Import settings JSON" }),
    );
    const futureJson = JSON.stringify({
      kind: BLOG_SETTINGS_TEMPLATE_KIND,
      schemaVersion: 999,
      settings: DEFAULT_BLOG_SETTINGS,
    });
    fireEvent.change(screen.getByLabelText(/Paste template JSON/), {
      target: { value: futureJson },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Unsupported schemaVersion/,
    );
  });
});
