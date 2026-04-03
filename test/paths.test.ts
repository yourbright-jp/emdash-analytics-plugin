import { describe, expect, it } from "vitest";

import { classifyPageKind, normalizePath } from "../src/content.js";

describe("normalizePath", () => {
  it("normalizes full urls to trailing-slash paths", () => {
    expect(normalizePath("https://www.yourbright.co.jp/blog/test")).toBe("/blog/test/");
  });

  it("rejects foreign hosts when expected host is provided", () => {
    expect(normalizePath("https://example.com/blog/test", "www.yourbright.co.jp")).toBeNull();
  });
});

describe("classifyPageKind", () => {
  it("detects blog posts", () => {
    expect(classifyPageKind("/blog/test-post/")).toBe("blog_post");
  });

  it("detects landing pages", () => {
    expect(classifyPageKind("/company/about/")).toBe("landing");
  });
});
