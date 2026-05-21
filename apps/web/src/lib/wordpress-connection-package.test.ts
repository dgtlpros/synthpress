import { describe, expect, it } from "vitest";
import {
  WORDPRESS_CONNECTION_PACKAGE_KIND,
  WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION,
  parseWordPressConnectionPackageJson,
} from "./wordpress-connection-package";

/**
 * Build a happy-path package literal so tests can clone + mutate
 * without restating every field. Anything missing here is what the
 * specific test is exercising.
 */
function buildPackage(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
    schemaVersion: WORDPRESS_CONNECTION_PACKAGE_SCHEMA_VERSION,
    exportedAt: "2026-05-21T03:32:00+00:00",
    site: {
      name: "My Blog",
      url: "https://example.com",
      adminUrl: "https://example.com/wp-admin/",
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
    ],
    ...overrides,
  });
}

describe("parseWordPressConnectionPackageJson", () => {
  describe("validation failures", () => {
    it("rejects empty input", () => {
      const result = parseWordPressConnectionPackageJson("");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("empty_input");
        expect(result.error.message).toMatch(/paste/i);
      }
    });

    it("rejects whitespace-only input as empty", () => {
      const result = parseWordPressConnectionPackageJson("   \n\t  ");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("empty_input");
    });

    it("rejects malformed JSON", () => {
      const result = parseWordPressConnectionPackageJson("{ not: 'json' }");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_json");
        expect(result.error.message).toMatch(/json/i);
      }
    });

    it.each([
      ["a JSON array", "[]"],
      ["a JSON number", "42"],
      ["JSON null", "null"],
      ["a JSON string", '"hello"'],
    ])("rejects non-object top-level (%s)", (_label, json) => {
      const result = parseWordPressConnectionPackageJson(json);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_an_object");
    });

    it("rejects the wrong `kind`", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: "synthpress.somethingElse",
          schemaVersion: 1,
          site: { url: "https://example.com" },
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("wrong_kind");
    });

    it("rejects an unsupported schemaVersion", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 99,
          site: { url: "https://example.com" },
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe("unsupported_schema_version");
    });

    it("rejects schemaVersion as a string (loose type checking would let v1 through)", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: "1",
          site: { url: "https://example.com" },
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe("unsupported_schema_version");
    });

    it("rejects a missing site block", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("missing_site");
    });

    it("rejects when site is not an object", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: "https://example.com",
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("missing_site");
    });

    it("rejects when site.url is missing", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: {},
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("missing_site_url");
    });

    it("rejects when site.url is the wrong type", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: 42 },
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("missing_site_url");
    });

    it("rejects when site.url is whitespace-only", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "   " },
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("missing_site_url");
    });

    it.each([
      ["javascript scheme", "javascript:alert(1)"],
      ["data scheme", "data:text/html,<script>"],
      ["file scheme", "file:///etc/passwd"],
      ["ftp scheme", "ftp://example.com"],
      ["bare host", "example.com"],
    ])("rejects an invalid site.url scheme (%s)", (_label, url) => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url },
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_site_url");
    });
  });

  describe("happy path", () => {
    it("parses a full valid package and returns no warnings", () => {
      const result = parseWordPressConnectionPackageJson(buildPackage());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
      expect(result.package).toEqual({
        kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
        schemaVersion: 1,
        exportedAt: "2026-05-21T03:32:00+00:00",
        site: {
          name: "My Blog",
          url: "https://example.com",
          adminUrl: "https://example.com/wp-admin/",
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
        ],
      });
    });

    it("accepts the minimum viable package (kind + schemaVersion + site.url)", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "http://example.com" },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.site.url).toBe("http://example.com");
      expect(result.package.site.name).toBeUndefined();
      expect(result.package.plugin).toBeUndefined();
      expect(result.package.recommendedUser).toBeUndefined();
      expect(result.package.readiness).toBeUndefined();
      expect(result.package.exportedAt).toBeUndefined();
    });

    it("trims leading/trailing whitespace inside string fields", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: {
            url: "   https://example.com   ",
            name: "  My Blog  ",
            wordpressVersion: "  6.7  ",
          },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.site.url).toBe("https://example.com");
      expect(result.package.site.name).toBe("My Blog");
      expect(result.package.site.wordpressVersion).toBe("6.7");
    });

    it("drops site.adminUrl / restUrl with non-http schemes", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: {
            url: "https://example.com",
            adminUrl: "javascript:alert(1)",
            restUrl: "data:text/html,",
          },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.site.adminUrl).toBeUndefined();
      expect(result.package.site.restUrl).toBeUndefined();
    });

    it("strips empty / whitespace-only optional string fields", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: {
            url: "https://example.com",
            name: "   ",
            wordpressVersion: "",
          },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.site.name).toBeUndefined();
      expect(result.package.site.wordpressVersion).toBeUndefined();
    });

    it("ignores unknown top-level fields", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          somethingUnknown: "nope",
          futureField: { nested: [1, 2, 3] },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        (result.package as unknown as Record<string, unknown>).somethingUnknown,
      ).toBeUndefined();
      expect(
        (result.package as unknown as Record<string, unknown>).futureField,
      ).toBeUndefined();
    });

    it("ignores unknown fields inside known objects (plugin/site/recommendedUser)", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com", future: "x" },
          plugin: { installed: true, version: "0.1.0", flag: "y" },
          recommendedUser: { login: "bot", exists: true, future: "z" },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        (result.package.site as unknown as Record<string, unknown>).future,
      ).toBeUndefined();
      expect(
        (result.package.plugin as unknown as Record<string, unknown>).flag,
      ).toBeUndefined();
      expect(
        (result.package.recommendedUser as unknown as Record<string, unknown>)
          .future,
      ).toBeUndefined();
    });
  });

  describe("plugin block", () => {
    it("omits the plugin block when none of its fields are valid", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          plugin: { installed: "yes", version: 42 },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.plugin).toBeUndefined();
    });

    it("keeps only the boolean field when only installed is valid", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          plugin: { installed: false, version: 42 },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.plugin).toEqual({ installed: false });
    });
  });

  describe("recommendedUser block", () => {
    it("ignores roles that aren't strings, dedupes leading/trailing space, and drops the empties", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          recommendedUser: {
            login: "bot",
            exists: true,
            roles: ["editor", 1, null, "  contributor  ", "  ", true, ""],
          },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.recommendedUser?.roles).toEqual([
        "editor",
        "contributor",
      ]);
    });

    it("omits roles entirely when none survive filtering", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          recommendedUser: { login: "bot", roles: [1, null, ""] },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.recommendedUser?.roles).toBeUndefined();
      expect(result.package.recommendedUser?.login).toBe("bot");
    });

    it("caps roles to a sensible maximum (no unbounded array growth)", () => {
      const tooMany = Array.from({ length: 200 }, (_, i) => `role-${i}`);
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          recommendedUser: { roles: tooMany },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.recommendedUser?.roles?.length).toBeLessThanOrEqual(
        16,
      );
    });

    it("omits the recommendedUser block entirely if every field is invalid", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          recommendedUser: { login: 42, exists: "yes", roles: "editor" },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.recommendedUser).toBeUndefined();
    });
  });

  describe("readiness rows", () => {
    it("drops rows that are not objects, miss fields, or have unknown statuses, and warns once", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          readiness: [
            { key: "a", label: "A", status: "pass", message: "ok" },
            { key: "b", label: "B", status: "warning", message: "soft" },
            { key: "c", label: "C", status: "fail", message: "hard" },
            "not an object",
            { key: "d", label: "D", status: "info", message: "weird" },
            { key: "e", label: "E", status: "pass" },
            null,
          ],
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.readiness?.map((r) => r.key)).toEqual([
        "a",
        "b",
        "c",
      ]);
      expect(
        result.warnings.some((w) => /unrecognized readiness/i.test(w)),
      ).toBe(true);
      expect(result.warnings.some((w) => /4 unrecognized/.test(w))).toBe(true);
    });

    it("uses the singular form of the warning when exactly one row is dropped", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          readiness: [
            { key: "a", label: "A", status: "pass", message: "ok" },
            { key: "b", label: "B", status: "wat" },
          ],
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        result.warnings.find((w) => /unrecognized readiness/i.test(w)),
      ).toMatch(/Skipped 1 unrecognized readiness row/);
    });

    it("omits the readiness array entirely when every row is invalid", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          readiness: [{ key: "x" }, "nope"],
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.readiness).toBeUndefined();
    });

    it("caps the readiness array to a sensible maximum and reports the overflow as dropped rows", () => {
      const tooMany = Array.from({ length: 50 }, (_, i) => ({
        key: `k-${i}`,
        label: `L ${i}`,
        status: "pass",
        message: "ok",
      }));
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          readiness: tooMany,
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.readiness?.length).toBe(32);
      expect(result.warnings.some((w) => /18 unrecognized/.test(w))).toBe(true);
    });

    it("ignores readiness entirely when not an array", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          readiness: { not: "an array" },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.readiness).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });
  });

  describe("forbidden / credential-shaped keys", () => {
    it.each([
      ["wp_app_password at top level", { wp_app_password: "shhh" }],
      ["wpAppPassword nested in site", { site: { wpAppPassword: "shhh" } }],
      [
        "applicationPassword inside plugin",
        { plugin: { installed: true, applicationPassword: "shhh" } },
      ],
      [
        "password buried 3 levels deep",
        { recommendedUser: { meta: { extra: { password: "shhh" } } } },
      ],
      [
        "apiKey on a readiness row",
        {
          readiness: [
            {
              key: "x",
              label: "X",
              status: "pass",
              message: "ok",
              apiKey: "leaky",
            },
          ],
        },
      ],
    ])("warns and ignores when the package contains %s", (_label, extra) => {
      const obj = JSON.parse(buildPackage()) as Record<string, unknown>;
      // Deep-merge the extra fields onto the happy-path package.
      for (const [k, v] of Object.entries(extra)) {
        if (
          v !== null &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          obj[k] !== null &&
          typeof obj[k] === "object" &&
          !Array.isArray(obj[k])
        ) {
          obj[k] = { ...(obj[k] as Record<string, unknown>), ...v };
        } else {
          obj[k] = v;
        }
      }
      const result = parseWordPressConnectionPackageJson(JSON.stringify(obj));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        result.warnings.some((w) =>
          /credentials \(password, api key, token\)/i.test(w),
        ),
      ).toBe(true);
      // The output never contains the forbidden key under any name.
      const serialised = JSON.stringify(result.package);
      expect(serialised).not.toMatch(/shhh/);
      expect(serialised).not.toMatch(/leaky/);
    });

    it("emits the credential warning only once, no matter how many forbidden keys appear", () => {
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: "https://example.com" },
          password: "a",
          appPassword: "b",
          wp_app_password: "c",
          token: "d",
          apiKey: "e",
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const credentialWarnings = result.warnings.filter((w) =>
        /credentials/i.test(w),
      );
      expect(credentialWarnings).toHaveLength(1);
    });

    it("tolerates self-referential / deep input without throwing", () => {
      const deep: Record<string, unknown> = {
        kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
        schemaVersion: 1,
        site: { url: "https://example.com" },
      };
      // Build a 25-deep nested object — past the recursion cap (12).
      let cursor: Record<string, unknown> = deep;
      for (let i = 0; i < 25; i++) {
        const next: Record<string, unknown> = {};
        cursor.nested = next;
        cursor = next;
      }
      // Plant a forbidden key past the depth limit; the walker should
      // STOP at depth 12 and not see it. That's by design — depth is
      // a DOS guard, not an exhaustive scanner.
      cursor.wp_app_password = "buried-too-deep";
      const result = parseWordPressConnectionPackageJson(JSON.stringify(deep));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => /credentials/i.test(w))).toBe(false);
    });
  });

  describe("clamping", () => {
    it("clamps obscenely long URL strings to a maximum", () => {
      const longUrl = "https://example.com/" + "a".repeat(10_000);
      const result = parseWordPressConnectionPackageJson(
        JSON.stringify({
          kind: WORDPRESS_CONNECTION_PACKAGE_KIND,
          schemaVersion: 1,
          site: { url: longUrl },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.package.site.url.length).toBeLessThanOrEqual(2048);
      expect(result.package.site.url.startsWith("https://example.com/")).toBe(
        true,
      );
    });
  });
});
