import type { Meta, StoryObj } from "@storybook/react";
import { WordPressPublishCard } from "./WordPressPublishCard";

const meta = {
  title: "Molecules/WordPressPublishCard",
  component: WordPressPublishCard,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof WordPressPublishCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseArgs = {
  hasConnection: true,
  hasBody: true,
  wpPostId: null,
  wpPostUrl: null,
  articleStatus: "ready_for_review" as const,
  connectionsHref: "/teams/t1/projects/p1/blogs/b1/connections",
};

export const Ready: Story = {
  args: baseArgs,
};

export const NotConnected: Story = {
  args: { ...baseArgs, hasConnection: false },
};

export const NoBody: Story = {
  args: { ...baseArgs, hasBody: false },
};

export const Sending: Story = {
  args: { ...baseArgs, isSending: true },
};

export const ErrorState: Story = {
  args: {
    ...baseArgs,
    errorMessage: "WordPress responded with 401 Unauthorized.",
  },
};

export const AlreadySentAsDraft: Story = {
  args: {
    ...baseArgs,
    wpPostId: 421,
    wpPostUrl: "https://example.com/?p=421",
  },
};

export const AlreadySentNoUrl: Story = {
  args: {
    ...baseArgs,
    wpPostId: 421,
    wpPostUrl: null,
  },
};

export const UpdatingDraft: Story = {
  args: {
    ...baseArgs,
    wpPostId: 421,
    wpPostUrl: "https://example.com/?p=421",
    isUpdating: true,
  },
};

export const PublishingLive: Story = {
  args: {
    ...baseArgs,
    wpPostId: 421,
    wpPostUrl: "https://example.com/?p=421",
    isPublishing: true,
  },
};

export const PublishedLive: Story = {
  args: {
    ...baseArgs,
    wpPostId: 421,
    wpPostUrl: "https://example.com/permalink",
    articleStatus: "published",
  },
};

export const RemoteDraftMissing: Story = {
  args: {
    ...baseArgs,
    wpPostId: 421,
    wpPostUrl: "https://example.com/?p=421",
    errorIsRemoteMissing: true,
    errorMessage:
      "The WordPress post could not be found. It may have been deleted in WordPress. Clear the link and send again as a new draft.",
  },
};

export const ClearingLink: Story = {
  args: {
    ...baseArgs,
    wpPostId: 421,
    wpPostUrl: "https://example.com/?p=421",
    errorIsRemoteMissing: true,
    errorMessage: "The WordPress post could not be found.",
    isClearing: true,
  },
};
