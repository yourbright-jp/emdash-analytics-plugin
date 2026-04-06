import { describe, expect, it } from "vitest";

import { extractAgentToken } from "../src/sync.js";

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
