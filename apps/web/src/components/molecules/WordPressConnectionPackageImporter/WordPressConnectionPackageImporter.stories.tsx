import type { Meta, StoryObj } from "@storybook/react";
import {
  WORDPRESS_CONNECTION_PACKAGE_KIND,
  WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION,
} from "@/lib/wordpress-connection-package";
import { WordPressConnectionPackageImporter } from "./WordPressConnectionPackageImporter";

const meta: Meta<typeof WordPressConnectionPackageImporter> = {
  title: "Molecules/WordPressConnectionPackageImporter",
  component: WordPressConnectionPackageImporter,
  parameters: { layout: "padded" },
  args: {
    currentUrl: "",
    currentUsername: "",
    onApply: () => undefined,
  },
};

export default meta;

type Story = StoryObj<typeof WordPressConnectionPackageImporter>;

export const Idle: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

const SAMPLE_PACKAGE = JSON.stringify(
  {
    kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
    schemaVersion: WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION,
    exportedAt: "2026-05-21T03:32:00+00:00",
    site: {
      name: "My Blog",
      url: "https://my-blog.example",
      adminUrl: "https://my-blog.example/wp-admin/",
      restUrl: "https://my-blog.example/wp-json/",
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
        message: "Base URL: https://my-blog.example/wp-json/",
      },
      {
        key: "https_enabled",
        label: "HTTPS enabled",
        status: "pass",
        message: "Detected.",
      },
      {
        key: "pretty_permalinks_enabled",
        label: "Pretty permalinks enabled",
        status: "warning",
        message: "Default permalinks work but pretty are recommended.",
      },
    ],
  },
  null,
  2,
);

export const WithSamplePackageInClipboard: Story = {
  name: "With sample package (paste this in)",
  args: { currentUrl: "", currentUsername: "" },
  parameters: {
    docs: {
      description: {
        story: `Use the textarea below in the Story canvas — copy this into it:\n\n\`\`\`json\n${SAMPLE_PACKAGE}\n\`\`\``,
      },
    },
  },
};
