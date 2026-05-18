import type { Meta, StoryObj } from "@storybook/react";
import type { NormalizedImageSearchResult } from "@/services/image-providers/types";
import { UnsplashPicker } from "./UnsplashPicker";

const meta = {
  title: "Molecules/UnsplashPicker",
  component: UnsplashPicker,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof UnsplashPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_PHOTOS: NormalizedImageSearchResult[] = [
  {
    provider: "unsplash",
    providerPhotoId: "1",
    description: null,
    altDescription: "Smart doorbell on a porch",
    thumbUrl:
      "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=300",
    regularUrl:
      "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=1080",
    fullUrl: null,
    photographerName: "Annie Spratt",
    photographerProfileUrl: "https://unsplash.com/@anniespratt",
    photoUrl: "https://unsplash.com/photos/1",
    downloadLocation: "https://api.unsplash.com/photos/1/download",
  },
  {
    provider: "unsplash",
    providerPhotoId: "2",
    description: null,
    altDescription: "Modern living room with smart speaker",
    thumbUrl:
      "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=300",
    regularUrl:
      "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1080",
    fullUrl: null,
    photographerName: "Patrick Perkins",
    photographerProfileUrl: "https://unsplash.com/@patrickperkins",
    photoUrl: "https://unsplash.com/photos/2",
    downloadLocation: "https://api.unsplash.com/photos/2/download",
  },
  {
    provider: "unsplash",
    providerPhotoId: "3",
    description: null,
    altDescription: "Smart thermostat on a wall",
    thumbUrl:
      "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=300",
    regularUrl:
      "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=1080",
    fullUrl: null,
    photographerName: "Sean D",
    photographerProfileUrl: "https://unsplash.com/@_seandavis",
    photoUrl: "https://unsplash.com/photos/3",
    downloadLocation: "https://api.unsplash.com/photos/3/download",
  },
];

const baseArgs = {
  open: true,
  onClose: () => {},
  query: "",
  onQueryChange: () => {},
  onSearch: () => {},
  onSelect: () => {},
  results: [],
  totalResults: null,
  hasSearched: false,
};

export const InitialState: Story = {
  args: baseArgs,
};

export const Searching: Story = {
  args: {
    ...baseArgs,
    query: "smart home",
    isSearching: true,
  },
};

export const WithResults: Story = {
  args: {
    ...baseArgs,
    query: "smart home",
    results: SAMPLE_PHOTOS,
    totalResults: 3,
    hasSearched: true,
  },
};

export const WithMoreUpstream: Story = {
  args: {
    ...baseArgs,
    query: "home office",
    results: SAMPLE_PHOTOS,
    totalResults: 1432,
    hasSearched: true,
  },
};

export const NoResults: Story = {
  args: {
    ...baseArgs,
    query: "asdfghjkl",
    results: [],
    totalResults: 0,
    hasSearched: true,
  },
};

export const ErrorState: Story = {
  args: {
    ...baseArgs,
    query: "cats",
    errorMessage: "Unsplash rate limit reached. Wait a minute and try again.",
    hasSearched: true,
  },
};

export const MissingApiKey: Story = {
  args: {
    ...baseArgs,
    query: "cats",
    errorMessage:
      "Unsplash is not configured. Add UNSPLASH_ACCESS_KEY to your environment to enable image search.",
    hasSearched: true,
  },
};

export const WithRecentlyUsed: Story = {
  args: {
    ...baseArgs,
    recentUploads: SAMPLE_PHOTOS.map((photo, index) => ({
      id: `recent-${index}`,
      imageUrl: photo.regularUrl,
      altText: photo.altDescription,
      provider: "unsplash",
      providerPhotoId: photo.providerPhotoId,
      photographerName: photo.photographerName ?? null,
      photographerProfileUrl: photo.photographerProfileUrl ?? null,
      photoUrl: photo.photoUrl ?? null,
      downloadLocation: photo.downloadLocation ?? null,
      wpMediaId: index === 0 ? 421 : null,
    })),
    onSelectRecent: () => {},
  },
};
