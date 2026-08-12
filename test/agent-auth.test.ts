import { hashPrefixedToken } from "@emdash-cms/auth";
import { describe, expect, it } from "vitest";

import {
  authenticateAgentKey,
  extractAgentToken,
  resolveAgentKeyScopes
} from "../src/sync.js";
import type { AgentKeyRecord } from "../src/types.js";

describe("extractAgentToken", () => {
  it("reads AgentKey authorization tokens", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "AgentKey yb_ins_example"
      }
    });

    expect(extractAgentToken(request)).toBe("yb_ins_example");
  });

  it("reads X-Emdash-Agent-Key when present", () => {
    const request = new Request("https://example.com", {
      headers: {
        "X-Emdash-Agent-Key": "yb_ins_example"
      }
    });

    expect(extractAgentToken(request)).toBe("yb_ins_example");
  });

  it("does not treat Bearer tokens as plugin agent keys", () => {
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer yb_ins_example"
      }
    });

    expect(extractAgentToken(request)).toBe("");
  });
});

describe("resolveAgentKeyScopes", () => {
  it("keeps legacy keys read-only", () => {
    expect(resolveAgentKeyScopes({})).toEqual(["analytics:read"]);
  });

  it("makes write keys explicitly readable and writable", () => {
    expect(resolveAgentKeyScopes({ scopes: ["content-insights:write"] })).toEqual([
      "content-insights:write",
      "analytics:read"
    ]);
  });

  it("makes sync keys explicitly readable without granting action writes", () => {
    expect(resolveAgentKeyScopes({ scopes: ["analytics:sync"] })).toEqual([
      "analytics:sync",
      "analytics:read"
    ]);
  });
});

describe("authenticateAgentRequest", () => {
  it("rejects a read-only key on write routes", async () => {
    const token = "yb_ins_read_only_example";
    const hash = hashPrefixedToken(token);
    const record: AgentKeyRecord = {
      prefix: "yb_ins_read",
      hash,
      label: "read only",
      scopes: ["analytics:read"],
      createdAt: "2026-07-01T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null
    };
    const agentKeys = agentKeyStorage(hash, record);
    const request = new Request("https://example.com", {
      headers: { Authorization: `AgentKey ${token}` }
    });

    await expect(
      authenticateAgentKey(agentKeys, request, "content-insights:write")
    ).rejects.toMatchObject({ code: "INSUFFICIENT_AGENT_SCOPE", status: 403 });
  });

  it("accepts a separately scoped write key", async () => {
    const token = "yb_ins_write_example";
    const hash = hashPrefixedToken(token);
    const record: AgentKeyRecord = {
      prefix: "yb_ins_write",
      hash,
      label: "automation writer",
      scopes: ["analytics:read", "content-insights:write"],
      createdAt: "2026-07-01T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null
    };
    const agentKeys = agentKeyStorage(hash, record);
    const request = new Request("https://example.com", {
      headers: { "X-Emdash-Agent-Key": token }
    });

    const authenticated = await authenticateAgentKey(
      agentKeys,
      request,
      "content-insights:write"
    );
    expect(authenticated.scopes).toContain("content-insights:write");
  });

  it("rejects a read and action-write key on analytics sync routes", async () => {
    const token = "yb_ins_writer_without_sync";
    const hash = hashPrefixedToken(token);
    const record: AgentKeyRecord = {
      prefix: "yb_ins_write",
      hash,
      label: "automation writer",
      scopes: ["analytics:read", "content-insights:write"],
      createdAt: "2026-07-01T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null
    };
    const request = new Request("https://example.com", {
      headers: { Authorization: `AgentKey ${token}` }
    });

    await expect(
      authenticateAgentKey(agentKeyStorage(hash, record), request, "analytics:sync")
    ).rejects.toMatchObject({ code: "INSUFFICIENT_AGENT_SCOPE", status: 403 });
  });

  it("accepts a dedicated analytics sync key", async () => {
    const token = "yb_ins_sync_example";
    const hash = hashPrefixedToken(token);
    const record: AgentKeyRecord = {
      prefix: "yb_ins_sync",
      hash,
      label: "analytics refresher",
      scopes: ["analytics:read", "analytics:sync"],
      createdAt: "2026-07-01T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null
    };
    const request = new Request("https://example.com", {
      headers: { Authorization: `AgentKey ${token}` }
    });

    const authenticated = await authenticateAgentKey(
      agentKeyStorage(hash, record),
      request,
      "analytics:sync"
    );
    expect(authenticated.scopes).toContain("analytics:sync");
    expect(authenticated.scopes).not.toContain("content-insights:write");
  });
});

function agentKeyStorage(expectedHash: string, initial: AgentKeyRecord) {
  return {
    async get(id: string) {
      return id === expectedHash ? initial : null;
    },
    async put(_id: string, _next: unknown) {
      // Authentication persists lastUsedAt; the behavior is not material to this scope test.
    }
  };
}
