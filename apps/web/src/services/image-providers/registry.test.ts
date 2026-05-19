import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_PROVIDER_ID,
  getImageProvider,
  listImageProviderIds,
} from "./registry";
import { pexelsProvider } from "./pexels-provider";
import { unsplashProvider } from "./unsplash-provider";
import { ImageSearchError } from "./types";

describe("image-provider registry", () => {
  it("exposes 'pexels' as the default provider id", () => {
    expect(DEFAULT_IMAGE_PROVIDER_ID).toBe("pexels");
  });

  it("returns the Pexels adapter for providerId='pexels'", () => {
    expect(getImageProvider("pexels")).toBe(pexelsProvider);
  });

  it("returns the default Pexels adapter when providerId is omitted", () => {
    expect(getImageProvider()).toBe(pexelsProvider);
  });

  it("still resolves the legacy Unsplash adapter (historical attribution rows)", () => {
    // Existing `article_image_uploads` rows whose `provider='unsplash'`
    // still need a working adapter for the WordPress publish path's
    // `trackDownload` ping. Unsplash stays registered for that exact
    // reason — it's just no longer the default + not surfaced in the UI.
    expect(getImageProvider("unsplash")).toBe(unsplashProvider);
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

  it("listImageProviderIds includes ONLY active providers ('pexels')", () => {
    const ids = listImageProviderIds();
    expect(ids).toContain("pexels");
    // Legacy providers must NOT appear in selectable lists, even
    // though they're resolvable via getImageProvider for historical
    // attribution / WordPress publish bookkeeping.
    expect(ids).not.toContain("unsplash");
  });
});

describe("ImageSearchError", () => {
  it("carries code + providerId + details on the instance", () => {
    const err = new ImageSearchError("rate_limited", {
      providerId: "pexels",
      details: "from-test",
    });
    expect(err.name).toBe("ImageSearchError");
    expect(err.code).toBe("rate_limited");
    expect(err.providerId).toBe("pexels");
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
