import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NormalizedImageSearchResult } from "@/services/image-providers/types";
import { UnsplashPicker } from "./UnsplashPicker";

beforeAll(() => {
  // jsdom doesn't implement <dialog>'s showModal/close. Stub them so
  // the Modal atom's open/close effect works inside tests.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.removeAttribute("open");
    };
  }
});

afterEach(cleanup);

const SAMPLE_PEXELS_PHOTO: NormalizedImageSearchResult = {
  provider: "pexels",
  providerPhotoId: "12345",
  description: "Desk with laptop",
  altDescription: "Desk with laptop",
  thumbUrl: "https://images.pexels.com/photos/12345/medium.jpg",
  regularUrl: "https://images.pexels.com/photos/12345/large.jpg",
  fullUrl: "https://images.pexels.com/photos/12345/original.jpg",
  photographerName: "Sam Person",
  photographerProfileUrl: "https://www.pexels.com/@sam",
  photoUrl: "https://www.pexels.com/photo/12345/",
  downloadLocation: null,
};

// Legacy provider sample — historical attribution rows whose
// `provider='unsplash'` still need to render correctly through the
// generic picker thumbnail.
const SAMPLE_UNSPLASH_PHOTO: NormalizedImageSearchResult = {
  provider: "unsplash",
  providerPhotoId: "abc",
  description: null,
  altDescription: "Desk with laptop",
  thumbUrl: "https://images.unsplash.com/photo-abc?w=200",
  regularUrl: "https://images.unsplash.com/photo-abc?w=1080",
  fullUrl: null,
  photographerName: "Annie Spratt",
  photographerProfileUrl: "https://unsplash.com/@anniespratt",
  photoUrl: "https://unsplash.com/photos/abc",
  downloadLocation: "https://api.unsplash.com/photos/abc/download",
};

const baseProps = {
  open: true,
  onClose: vi.fn(),
  query: "",
  onQueryChange: vi.fn(),
  onSearch: vi.fn(),
  onSelect: vi.fn(),
  results: [],
  totalResults: null,
  hasSearched: false,
};

describe("UnsplashPicker", () => {
  it("renders the provider-neutral title + description", () => {
    render(<UnsplashPicker {...baseProps} />);
    expect(screen.getByText("Pick image")).toBeInTheDocument();
    expect(
      screen.getByText(/Selecting an image only updates the form/i),
    ).toBeInTheDocument();
    // Title + description must NOT mention Unsplash anymore.
    expect(screen.queryByText(/Pick from Unsplash/i)).not.toBeInTheDocument();
  });

  it("calls onQueryChange as the user types", () => {
    const onQueryChange = vi.fn();
    render(<UnsplashPicker {...baseProps} onQueryChange={onQueryChange} />);
    const input = screen.getByLabelText(/search/i, { selector: "input" });
    fireEvent.change(input, { target: { value: "cats" } });
    expect(onQueryChange).toHaveBeenCalledWith("cats");
  });

  it("calls onSearch when the form is submitted with a non-empty query", () => {
    const onSearch = vi.fn();
    render(<UnsplashPicker {...baseProps} query="cats" onSearch={onSearch} />);
    fireEvent.submit(
      screen.getByLabelText(/search/i, { selector: "input" }).closest("form")!,
    );
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it("disables the Search button when the query is blank", () => {
    render(<UnsplashPicker {...baseProps} query="   " />);
    expect(screen.getByRole("button", { name: /^search$/i })).toBeDisabled();
  });

  it("disables the input + button while a search is in flight", () => {
    render(<UnsplashPicker {...baseProps} query="cats" isSearching />);
    expect(
      screen.getByLabelText(/search/i, { selector: "input" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /^search$/i })).toBeDisabled();
  });

  it("does not call onSearch when isSearching is true", () => {
    const onSearch = vi.fn();
    render(
      <UnsplashPicker
        {...baseProps}
        query="cats"
        onSearch={onSearch}
        isSearching
      />,
    );
    fireEvent.submit(
      screen.getByLabelText(/search/i, { selector: "input" }).closest("form")!,
    );
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("renders the error message in an alert region", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        errorMessage="Image search rate limit reached. Wait a minute and try again."
        hasSearched
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/rate limit/i);
  });

  it("renders the empty-state copy when a search returned zero hits", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        query="zzzzzzzzz"
        results={[]}
        totalResults={0}
        hasSearched
      />,
    );
    expect(screen.getByText(/No matches for/i)).toBeInTheDocument();
  });

  it("does NOT render the empty-state copy on first render (untouched modal)", () => {
    render(<UnsplashPicker {...baseProps} />);
    expect(screen.queryByText(/No matches for/i)).not.toBeInTheDocument();
  });

  it("does NOT render the empty-state copy while a search is in flight", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        query="cats"
        results={[]}
        totalResults={0}
        hasSearched
        isSearching
      />,
    );
    expect(screen.queryByText(/No matches for/i)).not.toBeInTheDocument();
  });

  it("renders Pexels thumbnails with 'Photo by X on Pexels' credit", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        results={[SAMPLE_PEXELS_PHOTO]}
        totalResults={1}
        hasSearched
      />,
    );
    expect(
      screen.getByRole("img", { name: /Desk with laptop/i }),
    ).toBeInTheDocument();
    const profileLink = screen.getByRole("link", { name: /Sam Person/i });
    expect(profileLink).toHaveAttribute("href", "https://www.pexels.com/@sam");
    const photoLink = screen.getByRole("link", { name: /^Pexels$/i });
    expect(photoLink).toHaveAttribute(
      "href",
      "https://www.pexels.com/photo/12345/",
    );
  });

  it("still renders legacy Unsplash attribution correctly for historical rows", () => {
    // Legacy rows persisted with `provider='unsplash'` keep showing
    // "on Unsplash" so an existing post's credit stays accurate
    // even though the active picker is Pexels.
    render(
      <UnsplashPicker
        {...baseProps}
        results={[SAMPLE_UNSPLASH_PHOTO]}
        totalResults={1}
        hasSearched
      />,
    );
    const photoLink = screen.getByRole("link", { name: /^Unsplash$/i });
    expect(photoLink).toHaveAttribute(
      "href",
      "https://unsplash.com/photos/abc",
    );
  });

  it("calls onSelect with the photo when a thumbnail is clicked", () => {
    const onSelect = vi.fn();
    render(
      <UnsplashPicker
        {...baseProps}
        onSelect={onSelect}
        results={[SAMPLE_PEXELS_PHOTO]}
        totalResults={1}
        hasSearched
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Select photo by Sam Person/i }),
    );
    expect(onSelect).toHaveBeenCalledWith(SAMPLE_PEXELS_PHOTO);
  });

  it("falls back to description when altDescription is missing", () => {
    const photo: NormalizedImageSearchResult = {
      ...SAMPLE_PEXELS_PHOTO,
      altDescription: null,
      description: "A modern home office",
    };
    render(
      <UnsplashPicker
        {...baseProps}
        results={[photo]}
        totalResults={1}
        hasSearched
      />,
    );
    expect(
      screen.getByRole("img", { name: /A modern home office/i }),
    ).toBeInTheDocument();
  });

  it("falls back to a 'Photo by <name>' alt when both descriptions are missing", () => {
    const photo: NormalizedImageSearchResult = {
      ...SAMPLE_PEXELS_PHOTO,
      altDescription: null,
      description: null,
    };
    render(
      <UnsplashPicker
        {...baseProps}
        results={[photo]}
        totalResults={1}
        hasSearched
      />,
    );
    expect(
      screen.getByRole("img", { name: /^Photo by Sam Person$/i }),
    ).toBeInTheDocument();
  });

  it("falls back to a neutral alt + aria when the photo has no photographer name", () => {
    // Mirrors a future provider (e.g. AI image gen, or a Pexels row
    // with a missing photographer field) — the picker degrades to
    // "Image from Pexels" instead of leaking 'null' into the alt.
    const photo: NormalizedImageSearchResult = {
      ...SAMPLE_PEXELS_PHOTO,
      altDescription: null,
      description: null,
      photographerName: null,
    };
    render(
      <UnsplashPicker
        {...baseProps}
        results={[photo]}
        totalResults={1}
        hasSearched
      />,
    );
    expect(
      screen.getByRole("img", { name: "Image from Pexels" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select this photo" }),
    ).toBeInTheDocument();
  });

  it("renders a span (not an anchor) when photographerProfileUrl is null", () => {
    const photo: NormalizedImageSearchResult = {
      ...SAMPLE_PEXELS_PHOTO,
      photographerProfileUrl: null,
    };
    render(
      <UnsplashPicker
        {...baseProps}
        results={[photo]}
        totalResults={1}
        hasSearched
      />,
    );
    // Photographer name still renders, but not as a link.
    expect(
      screen.queryByRole("link", { name: "Sam Person" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Sam Person")).toBeInTheDocument();
  });

  it("falls back to 'a Pexels photographer' when both name and profile URL are missing", () => {
    const photo: NormalizedImageSearchResult = {
      ...SAMPLE_PEXELS_PHOTO,
      photographerName: null,
      photographerProfileUrl: null,
    };
    render(
      <UnsplashPicker
        {...baseProps}
        results={[photo]}
        totalResults={1}
        hasSearched
      />,
    );
    expect(screen.getByText("a Pexels photographer")).toBeInTheDocument();
  });

  it("renders 'Pexels' as a span (not a link) when photoUrl is null", () => {
    const photo: NormalizedImageSearchResult = {
      ...SAMPLE_PEXELS_PHOTO,
      photoUrl: null,
    };
    render(
      <UnsplashPicker
        {...baseProps}
        results={[photo]}
        totalResults={1}
        hasSearched
      />,
    );
    expect(
      screen.queryByRole("link", { name: /^Pexels$/ }),
    ).not.toBeInTheDocument();
  });

  it("disables thumbnail buttons while isSearching is true", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        results={[SAMPLE_PEXELS_PHOTO]}
        totalResults={1}
        hasSearched
        isSearching
      />,
    );
    expect(
      screen.getByRole("button", { name: /Select photo by Sam Person/i }),
    ).toBeDisabled();
  });

  it("renders a centered spinner on the very first in-flight search (no results yet)", () => {
    const { container } = render(
      <UnsplashPicker
        {...baseProps}
        query="cats"
        isSearching
        hasSearched={false}
      />,
    );
    expect(container.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("shows the 'Showing N of M' helper when there are more results upstream", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        results={[SAMPLE_PEXELS_PHOTO]}
        totalResults={42}
        hasSearched
      />,
    );
    expect(screen.getByText(/Showing 1 of 42 results/i)).toBeInTheDocument();
  });

  it("does NOT show the 'Showing N of M' helper when results match total", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        results={[SAMPLE_PEXELS_PHOTO]}
        totalResults={1}
        hasSearched
      />,
    );
    expect(screen.queryByText(/Showing/i)).not.toBeInTheDocument();
  });

  it("renders the search-tip helper on first render (no search yet, no error) WITHOUT mentioning Unsplash", () => {
    render(<UnsplashPicker {...baseProps} />);
    // Generic tip is shown.
    expect(
      screen.getByText(/Tip:.*search for the subject/i),
    ).toBeInTheDocument();
    // Old "Photos courtesy of Unsplash" line is gone.
    expect(screen.queryByText(/Photos courtesy of/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unsplash/i)).not.toBeInTheDocument();
  });

  it("hides the help/tip text after a search has been fired", () => {
    render(<UnsplashPicker {...baseProps} hasSearched />);
    expect(
      screen.queryByText(/Tip:.*search for the subject/i),
    ).not.toBeInTheDocument();
  });

  // ---------- Recently used section ----------

  const SAMPLE_RECENT = {
    id: "row-1",
    imageUrl: "https://example.com/used.jpg",
    altText: "Previously used photo",
    provider: "pexels",
    providerPhotoId: "12345",
    photographerName: "Sam Person",
    photographerProfileUrl: "https://www.pexels.com/@sam",
    photoUrl: "https://www.pexels.com/photo/12345/",
    downloadLocation: null,
    wpMediaId: 99,
  };

  it("does NOT render the Recently used section when no recents are supplied", () => {
    render(<UnsplashPicker {...baseProps} />);
    expect(
      screen.queryByTestId("image-picker-recents"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the Recently used section when the list is empty", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        recentUploads={[]}
        onSelectRecent={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("image-picker-recents"),
    ).not.toBeInTheDocument();
  });

  it("renders the Recently used section with thumbnails when recents exist", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        recentUploads={[SAMPLE_RECENT]}
        onSelectRecent={vi.fn()}
      />,
    );
    expect(screen.getByText(/Recently used/i)).toBeInTheDocument();
    expect(screen.getByTestId("image-picker-recents")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Previously used photo/i }),
    ).toBeInTheDocument();
  });

  it("calls onSelectRecent with the upload row when a recent thumbnail is clicked", () => {
    const onSelectRecent = vi.fn();
    render(
      <UnsplashPicker
        {...baseProps}
        recentUploads={[SAMPLE_RECENT]}
        onSelectRecent={onSelectRecent}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Reuse image by Sam Person/i }),
    );
    expect(onSelectRecent).toHaveBeenCalledWith(SAMPLE_RECENT);
  });

  it("uses a generic aria-label when the recent row has no photographer name", () => {
    const noNameRow = {
      ...SAMPLE_RECENT,
      photographerName: null,
    };
    render(
      <UnsplashPicker
        {...baseProps}
        recentUploads={[noNameRow]}
        onSelectRecent={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Reuse this image/i }),
    ).toBeInTheDocument();
  });

  it("falls back to a generic alt when the recent row has no altText", () => {
    const noAltRow = { ...SAMPLE_RECENT, altText: null };
    render(
      <UnsplashPicker
        {...baseProps}
        recentUploads={[noAltRow]}
        onSelectRecent={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("img", {
        name: /Previously used image by Sam Person/i,
      }),
    ).toBeInTheDocument();
  });

  it("falls back to a generic alt when both altText AND photographer are missing", () => {
    const minimalRow = {
      ...SAMPLE_RECENT,
      altText: null,
      photographerName: null,
    };
    render(
      <UnsplashPicker
        {...baseProps}
        recentUploads={[minimalRow]}
        onSelectRecent={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("img", { name: /^Previously used image$/i }),
    ).toBeInTheDocument();
  });

  it("hides the Recently used section once the user has searched (search results take over)", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        recentUploads={[SAMPLE_RECENT]}
        onSelectRecent={vi.fn()}
        hasSearched
      />,
    );
    expect(
      screen.queryByTestId("image-picker-recents"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the Recently used section when onSelectRecent is omitted (defensive)", () => {
    render(<UnsplashPicker {...baseProps} recentUploads={[SAMPLE_RECENT]} />);
    expect(
      screen.queryByTestId("image-picker-recents"),
    ).not.toBeInTheDocument();
  });
});
