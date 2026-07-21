import { describe, expect, it } from "vitest";

import { PUBLIC_AGENT_ROUTES } from "../src/constants.js";
import { createPlugin } from "../src/index.js";

describe("plugin contract", () => {
  it("keeps the existing read endpoints and exposes the action ledger routes", () => {
    const plugin = createPlugin();

    for (const route of Object.values(PUBLIC_AGENT_ROUTES)) {
      expect(plugin.routes[route]).toBeDefined();
      expect(plugin.routes[route]?.public).toBe(true);
    }
  });

  it("declares the D1-backed action ledger collections and indexes", () => {
    const plugin = createPlugin();

    expect(plugin.storage.content_insight_actions).toMatchObject({
      indexes: expect.arrayContaining(["status", "contentKey", "updatedAt"]),
      uniqueIndexes: ["idempotencyKeyHash", "openContentKey"]
    });
    expect(plugin.storage.content_insight_action_events).toMatchObject({
      indexes: expect.arrayContaining(["actionId", "eventType", "createdAt"])
    });
    expect(plugin.storage.content_insight_measurements).toMatchObject({
      indexes: expect.arrayContaining(["actionId", "phase", "periodStart", "periodEnd"])
    });
  });
});
