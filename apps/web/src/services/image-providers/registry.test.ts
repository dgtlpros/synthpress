import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_PROVIDER_ID,
  getImageProvider,
  listImageProviderIds,
} from "./registry";
import { unsplashProvider } from "./unsplash-provider";
import { ImageSearchError } from "./types";

describe("image-provider registry", () => {
  it("exposes 'unsplash' as the default provider id", () => {
    expect(DEFAULT_IMAGE_PROVIDER_ID).toBe("unsplash");
  });

  it("returns the Unsplash adapter for providerId='unsplash'", () => {
    expect(getImageProvider("unsplash")).toBe(unsplashProvider);
  });

  it("returns the default Unsplash adapter when providerId is omitted", () => {
    expect(getImageProvider()).toBe(unsplashProvider);
  });

  it("throws ImageSearchError(unsupported_provider) for unknown providers", () => {
    let caught: ImageSearchError | undefined;
    try {
      getImageProvider("does-not-exist");
    } catch (err) {
      caught = err as ImageSearchError;
    }
    expect(caught).toBeInstanceOf(ImageSearchError);
    expect(caught?.code).toBe("unsupported_provider");
    expect(caught?.providerId).toBe("does-not-exist");
    expect(caught?.details).toBe("does-not-exist");
  });

  it("listImageProviderIds includes 'unsplash'", () => {
    expect(listImageProviderIds()).toContain("unsplash");
  });
});

describe("ImageSearchError", () => {
  it("carries code + providerId + details on the instance", () => {
    const err = new ImageSearchError("rate_limited", {
      providerId: "unsplash",
      details: "from-test",
    });
    expect(err.name).toBe("ImageSearchError");
    expect(err.code).toBe("rate_limited");
    expect(err.providerId).toBe("unsplash");
    expect(err.details).toBe("from-test");
    expect(err.message).toBe("image_search_error:rate_limited:from-test");
  });

  it("defaults providerId to null and omits details from the message when missing", () => {
    const err = new ImageSearchError("query_required");
    expect(err.providerId).toBeNull();
    expect(err.details).toBeUndefined();
    expect(err.message).toBe("image_search_error:query_required");
  });
});
