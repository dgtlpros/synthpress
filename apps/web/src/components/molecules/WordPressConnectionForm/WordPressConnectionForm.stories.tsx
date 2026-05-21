import type { Meta, StoryObj } from "@storybook/react";
import { WordPressConnectionForm } from "./WordPressConnectionForm";

const meta = {
  title: "Molecules/WordPressConnectionForm",
  component: WordPressConnectionForm,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof WordPressConnectionForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotConnected: Story = {
  args: {
    initialUrl: null,
    initialUsername: null,
    hasStoredPassword: false,
    onSubmit: () => {},
  },
};

export const Connected: Story = {
  args: {
    initialUrl: "https://example.com",
    initialUsername: "alice",
    hasStoredPassword: true,
    onSubmit: () => {},
    onDisconnect: () => {},
  },
};

export const WithError: Story = {
  args: {
    initialUrl: "https://example.com",
    initialUsername: "alice",
    hasStoredPassword: true,
    onSubmit: () => {},
    onDisconnect: () => {},
    error: "Authentication failed: HTTP 403.",
  },
};

export const WithTestConnectionIdle: Story = {
  args: {
    initialUrl: "https://example.com",
    initialUsername: "alice",
    hasStoredPassword: true,
    onSubmit: () => {},
    onDisconnect: () => {},
    onTestConnection: () => {},
  },
};

export const WithTestConnectionLoading: Story = {
  args: {
    initialUrl: "https://example.com",
    initialUsername: "alice",
    hasStoredPassword: true,
    onSubmit: () => {},
    onDisconnect: () => {},
    onTestConnection: () => {},
    isTesting: true,
  },
};

export const WithTestConnectionSuccess: Story = {
  args: {
    initialUrl: "https://example.com",
    initialUsername: "alice",
    hasStoredPassword: true,
    onSubmit: () => {},
    onDisconnect: () => {},
    onTestConnection: () => {},
    testResult: {
      ok: true,
      siteUrl: "https://example.com",
      user: {
        id: 42,
        name: "Alice Admin",
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
    },
  },
};

export const WithTestConnectionWarnings: Story = {
  args: {
    initialUrl: "https://example.com",
    initialUsername: "bob",
    hasStoredPassword: true,
    onSubmit: () => {},
    onDisconnect: () => {},
    onTestConnection: () => {},
    testResult: {
      ok: true,
      siteUrl: "https://example.com",
      user: { id: 9, slug: "bob", roles: ["author"] },
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
    },
  },
};

export const WithTestConnectionFailure: Story = {
  args: {
    initialUrl: "https://example.com",
    initialUsername: "alice",
    hasStoredPassword: true,
    onSubmit: () => {},
    onDisconnect: () => {},
    onTestConnection: () => {},
    testResult: {
      ok: false,
      siteUrl: "https://example.com",
      warnings: [],
      error: {
        code: "unauthorized",
        message:
          "WordPress rejected these credentials. Check the username and Application Password.",
      },
    },
  },
};
