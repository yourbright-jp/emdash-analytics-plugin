import { describe, expect, it } from "vitest";

import { resolveConfigInput } from "../src/config-validation.js";

const existingConfig = {
  siteOrigin: "https://www.yourbright.co.jp",
  ga4PropertyId: "123456789",
  gscSiteUrl: "https://www.yourbright.co.jp/",
  serviceAccountJson: JSON.stringify({
    client_email: "emdash-analytics@yourbright.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----"
  })
};

describe("resolveConfigInput", () => {
  it("preserves the stored service account when updating non-secret fields", () => {
    const result = resolveConfigInput(
      {
        siteOrigin: "https://www.yourbright.co.jp/blog",
        ga4PropertyId: "987654321",
        gscSiteUrl: "sc-domain:yourbright.co.jp"
      },
      existingConfig
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.siteOrigin).toBe("https://www.yourbright.co.jp");
    expect(result.data.ga4PropertyId).toBe("987654321");
    expect(result.data.gscSiteUrl).toBe("sc-domain:yourbright.co.jp");
    expect(result.data.serviceAccountJson).toBe(existingConfig.serviceAccountJson);
  });

  it("preserves stored non-secret fields when the draft leaves them blank", () => {
    const result = resolveConfigInput(
      {
        siteOrigin: "",
        ga4PropertyId: "",
        gscSiteUrl: "",
        serviceAccountJson: ""
      },
      existingConfig
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.siteOrigin).toBe(existingConfig.siteOrigin);
    expect(result.data.ga4PropertyId).toBe(existingConfig.ga4PropertyId);
    expect(result.data.gscSiteUrl).toBe(existingConfig.gscSiteUrl);
    expect(result.data.serviceAccountJson).toBe(existingConfig.serviceAccountJson);
  });

  it("requires service account credentials on the first save", () => {
    const result = resolveConfigInput({
      siteOrigin: "https://www.yourbright.co.jp",
      ga4PropertyId: "123456789",
      gscSiteUrl: "https://www.yourbright.co.jp/"
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.message).toContain("Service Account JSON is required");
  });
});
