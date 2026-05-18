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

const SAMPLE_PHOTO: NormalizedImageSearchResult = {
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
  it("renders the title + description", () => {
    render(<UnsplashPicker {...baseProps} />);
    expect(screen.getByText("Pick from Unsplash")).toBeInTheDocument();
    expect(
      screen.getByText(/Selecting an image only updates the form/i),
    ).toBeInTheDocument();
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
        errorMessage="Unsplash rate limit reached. Wait a minute and try again."
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

  it("renders the results grid with photographer credits", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        results={[SAMPLE_PHOTO]}
        totalResults={1}
        hasSearched
      />,
    );
    expect(
      screen.getByRole("img", { name: /Desk with laptop/i }),
    ).toBeInTheDocument();
    const profileLink = screen.getByRole("link", {
      name: /Annie Spratt/i,
    });
    expect(profileLink).toHaveAttribute(
      "href",
      "https://unsplash.com/@anniespratt",
    );
    const photoLink = screen.getByRole("link", {
      name: /Unsplash/i,
    });
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
        results={[SAMPLE_PHOTO]}
        totalResults={1}
        hasSearched
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Select Unsplash photo by Annie Spratt/i,
      }),
    );
    expect(onSelect).toHaveBeenCalledWith(SAMPLE_PHOTO);
  });

  it("falls back to description when altDescription is missing", () => {
    const photo = {
      ...SAMPLE_PHOTO,
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

  it("falls back to a generic alt when both descriptions are missing", () => {
    const photo = {
      ...SAMPLE_PHOTO,
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
      screen.getByRole("img", {
        name: /Unsplash photo by Annie Spratt/i,
      }),
    ).toBeInTheDocument();
  });

  it("falls back to a neutral alt + aria when the provider has no photographer name", () => {
    // Mirrors a future non-Unsplash provider (e.g. AI image gen) that
    // doesn't carry a photographer field.
    const photo: NormalizedImageSearchResult = {
      ...SAMPLE_PHOTO,
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
      screen.getByRole("img", { name: "Unsplash photo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select this Unsplash photo" }),
    ).toBeInTheDocument();
  });

  it("renders a span (not an anchor) when photographerProfileUrl is null", () => {
    const photo: NormalizedImageSearchResult = {
      ...SAMPLE_PHOTO,
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
      screen.queryByRole("link", { name: "Annie Spratt" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Annie Spratt")).toBeInTheDocument();
  });

  it("falls back to 'an Unsplash photographer' when both name and profile URL are missing", () => {
    const photo: NormalizedImageSearchResult = {
      ...SAMPLE_PHOTO,
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
    expect(
      screen.getByText("an Unsplash photographer"),
    ).toBeInTheDocument();
  });

  it("renders 'Unsplash' as a span (not a link) when photoUrl is null", () => {
    const photo: NormalizedImageSearchResult = {
      ...SAMPLE_PHOTO,
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
      screen.queryByRole("link", { name: /^Unsplash$/ }),
    ).not.toBeInTheDocument();
  });

  it("disables thumbnail buttons while isSearching is true", () => {
    render(
      <UnsplashPicker
        {...baseProps}
        results={[SAMPLE_PHOTO]}
        totalResults={1}
        hasSearched
        isSearching
      />,
    );
    expect(
      screen.getByRole("button", {
        name: /Select Unsplash photo by Annie Spratt/i,
      }),
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
        results={[SAMPLE_PHOTO]}
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
        results={[SAMPLE_PHOTO]}
        totalResults={1}
        hasSearched
      />,
    );
    expect(screen.queryByText(/Showing/i)).not.toBeInTheDocument();
  });

  it("renders the help/credits hint on first render (no search yet, no error)", () => {
    render(<UnsplashPicker {...baseProps} />);
    expect(screen.getByText(/Photos courtesy of/i)).toBeInTheDocument();
  });

  it("hides the help/credits hint after a search has been fired", () => {
    render(<UnsplashPicker {...baseProps} hasSearched />);
    expect(screen.queryByText(/Photos courtesy of/i)).not.toBeInTheDocument();
  });

  // ---------- Recently used section ----------

  const SAMPLE_RECENT = {
    id: "row-1",
    imageUrl: "https://example.com/used.jpg",
    altText: "Previously used photo",
    provider: "unsplash",
    providerPhotoId: "abc",
    photographerName: "Annie Spratt",
    photographerProfileUrl: "https://unsplash.com/@anniespratt",
    photoUrl: "https://unsplash.com/photos/abc",
    downloadLocation: "https://api.unsplash.com/photos/abc/download",
    wpMediaId: 99,
  };

  it("does NOT render the Recently used section when no recents are supplied", () => {
    render(<UnsplashPicker {...baseProps} />);
    expect(
      screen.queryByTestId("unsplash-picker-recents"),
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
      screen.queryByTestId("unsplash-picker-recents"),
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
    expect(screen.getByTestId("unsplash-picker-recents")).toBeInTheDocument();
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
      screen.getByRole("button", { name: /Reuse image by Annie Spratt/i }),
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
        name: /Previously used image by Annie Spratt/i,
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
      screen.queryByTestId("unsplash-picker-recents"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the Recently used section when onSelectRecent is omitted (defensive)", () => {
    render(<UnsplashPicker {...baseProps} recentUploads={[SAMPLE_RECENT]} />);
    expect(
      screen.queryByTestId("unsplash-picker-recents"),
    ).not.toBeInTheDocument();
  });
});
