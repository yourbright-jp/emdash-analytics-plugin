import { describe, expect, it } from "vitest";

import { scorePage } from "../src/scoring.js";

describe("scorePage", () => {
  it("assigns multiple tags when a page has clear issues", () => {
    const result = scorePage(
      {
        gscImpressions28d: 2400,
        gscCtr28d: 0.012,
        gscPosition28d: 8.4,
        gscClicks28d: 100,
        gscClicksPrev28d: 180,
        gaViews28d: 400,
        gaViewsPrev28d: 620,
        gaEngagementRate28d: 0.42,
        gaBounceRate28d: 0.74
      },
      [
        {
          urlPath: "/blog/example/",
          query: "example query",
          clicks28d: 2,
          impressions28d: 180,
          ctr28d: 0.011,
          position28d: 9.1,
          updatedAt: new Date().toISOString()
        }
      ]
    );

    expect(result.score).toBe(100);
    expect(result.tags).toEqual([
      "high-impression-low-ctr",
      "ranking-near-page-1",
      "traffic-decline",
      "weak-engagement",
      "query-capture-gap"
    ]);
  });
});
