import type { OpportunityEvidence, OpportunityTag, PageAggregateRecord, PageQueryRecord } from "./types.js";

export function scorePage(
  page: Pick<
    PageAggregateRecord,
    | "gscImpressions28d"
    | "gscCtr28d"
    | "gscPosition28d"
    | "gscClicks28d"
    | "gscClicksPrev28d"
    | "gaViews28d"
    | "gaViewsPrev28d"
    | "gaEngagementRate28d"
    | "gaBounceRate28d"
  >,
  queries: PageQueryRecord[] = []
): { score: number; tags: OpportunityTag[]; evidence: OpportunityEvidence[] } {
  let score = 0;
  const tags: OpportunityTag[] = [];
  const evidence: OpportunityEvidence[] = [];

  if (page.gscImpressions28d >= 1000 && page.gscCtr28d < 0.03) {
    score += 35;
    tags.push("high-impression-low-ctr");
    evidence.push({
      tag: "high-impression-low-ctr",
      reason: `CTR ${toPercent(page.gscCtr28d)} with ${page.gscImpressions28d} impressions`
    });
  }

  if (
    page.gscPosition28d >= 4 &&
    page.gscPosition28d <= 15 &&
    page.gscImpressions28d >= 300
  ) {
    score += 20;
    tags.push("ranking-near-page-1");
    evidence.push({
      tag: "ranking-near-page-1",
      reason: `Average position ${page.gscPosition28d.toFixed(1)} with meaningful impressions`
    });
  }

  if (
    (page.gscClicksPrev28d > 0 && page.gscClicks28d <= page.gscClicksPrev28d * 0.8) ||
    (page.gaViewsPrev28d > 0 && page.gaViews28d <= page.gaViewsPrev28d * 0.8)
  ) {
    score += 20;
    tags.push("traffic-decline");
    evidence.push({
      tag: "traffic-decline",
      reason: `Traffic declined versus previous window`
    });
  }

  if (
    page.gaViews28d >= 200 &&
    (page.gaEngagementRate28d < 0.5 || page.gaBounceRate28d > 0.6)
  ) {
    score += 15;
    tags.push("weak-engagement");
    evidence.push({
      tag: "weak-engagement",
      reason: `Engagement ${toPercent(page.gaEngagementRate28d)}, bounce ${toPercent(page.gaBounceRate28d)}`
    });
  }

  const hasQueryGap = queries.some((query) => query.impressions28d >= 100 && query.ctr28d < 0.02);
  if (hasQueryGap) {
    score += 10;
    tags.push("query-capture-gap");
    evidence.push({
      tag: "query-capture-gap",
      reason: "One or more high-impression queries have weak CTR"
    });
  }

  return { score, tags, evidence };
}

function toPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
