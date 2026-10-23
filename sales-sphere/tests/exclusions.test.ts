import { describe, expect, it } from "vitest";
import { ExclusionSet, toExclusionEntry } from "@/lib/pipeline/exclusions";

describe("ExclusionSet", () => {
  const ex = new ExclusionSet([
    { kind: "domain", value: "https://www.client.com" },
    { kind: "company", value: "Business Experts MEA" },
    { kind: "domain", value: "notinterested.io" },
  ]);

  it("blocks the domain and its subdomains", () => {
    expect(ex.isDomainExcluded("client.com")).toBe(true);
    expect(ex.isDomainExcluded("uk.client.com")).toBe(true);
    expect(ex.isDomainExcluded("notclient.com")).toBe(false);
  });

  it("matches company names ignoring legal suffixes and punctuation", () => {
    expect(ex.isNameExcluded("Business Experts MEA LLC")).toBe(true);
    expect(ex.isNameExcluded("business-experts mea")).toBe(true);
    expect(ex.isNameExcluded("Business Experts")).toBe(false);
  });

  it("checks contact email domains too", () => {
    expect(ex.check({ email: "jane@notinterested.io" })).toMatch(/email domain/);
    expect(ex.check({ domain: "fine.com", name: "Fine Co", email: "a@fine.com" })).toBeNull();
  });
});

describe("toExclusionEntry", () => {
  it("parses domains and names", () => {
    expect(toExclusionEntry("www.acme.com")).toEqual({ kind: "domain", value: "acme.com" });
    expect(toExclusionEntry("Business Experts MEA")).toEqual({ kind: "company", value: "business experts mea" });
    expect(toExclusionEntry("  ")).toBeNull();
  });
});
