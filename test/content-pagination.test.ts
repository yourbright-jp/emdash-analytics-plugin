import { afterEach, describe, expect, it, vi } from "vitest";
import { getEmDashCollection } from "emdash";
import { getManagedContentMap } from "../src/content.js";

vi.mock("emdash", () => ({
  getEmDashCollection: vi.fn(),
  getEmDashEntry: vi.fn()
}));

afterEach(() => vi.resetAllMocks());

describe("managed content collection coverage", () => {
  it("reads beyond 50 entries and preserves database IDs for API callers", async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => ({
      id: `article-${i}`, slug: `article-${i}`,
      data: { id: `cms-${i}`, title: `Article ${i}` }
    }));
    vi.mocked(getEmDashCollection)
      .mockResolvedValueOnce({ entries: firstPage, nextCursor: "page-2", hasMore: true, cacheHint: {} } as never)
      .mockResolvedValueOnce({ entries: [{ id: "culture-article", slug: "culture-article", data: { id: "cms-culture", title: "Culture" } }], hasMore: false, cacheHint: {} } as never);

    const result = await getManagedContentMap("https://www.yourbright.co.jp");

    expect(result.size).toBe(51);
    expect(result.get("/blog/culture-article/")?.id).toBe("cms-culture");
    expect(getEmDashCollection).toHaveBeenNthCalledWith(2, "posts", expect.objectContaining({ cursor: "page-2", orderBy: { updated_at: "desc" } }));
  });

  it("does not accept a partial map when a later page fails", async () => {
    vi.mocked(getEmDashCollection)
      .mockResolvedValueOnce({ entries: [{ id: "one", slug: "one", data: {} }], nextCursor: "next", hasMore: true, cacheHint: {} } as never)
      .mockResolvedValueOnce({ entries: [], error: new Error("collection read failed"), cacheHint: {} } as never);
    await expect(getManagedContentMap("https://www.yourbright.co.jp")).rejects.toThrow("collection read failed");
  });

  it("rejects missing or repeated cursors instead of silently omitting posts", async () => {
    vi.mocked(getEmDashCollection).mockResolvedValueOnce({ entries: [], hasMore: true, cacheHint: {} } as never);
    await expect(getManagedContentMap("https://www.yourbright.co.jp")).rejects.toThrow("before the final page");
    vi.mocked(getEmDashCollection)
      .mockResolvedValueOnce({ entries: [], hasMore: true, nextCursor: "same", cacheHint: {} } as never)
      .mockResolvedValueOnce({ entries: [], hasMore: true, nextCursor: "same", cacheHint: {} } as never);
    await expect(getManagedContentMap("https://www.yourbright.co.jp")).rejects.toThrow("did not advance");
  });
});
