import { describe, expect, it } from "vitest";
import { dedupeCandidates, type Candidate } from "@/lib/pipeline/dedupe";
import { ExclusionSet } from "@/lib/pipeline/exclusions";
import { normalizeDomain } from "@/lib/domain";

const cand = (name: string, domain: string | null, url = `https://${domain ?? "x.test"}/`): Candidate => ({ name, domain, signal: "s", evidence: [{ url }] });
const none = new ExclusionSet([]);

describe("normalizeDomain", () => {
  it.each([
    ["https://www.Acme.com/about?x=1", "acme.com"],
    ["acme.co.uk", "acme.co.uk"],
    ["jane@Acme.com", "acme.com"],
    ["http://www2.acme.com:8080", "acme.com"],
    ["not a domain", null],
    ["", null],
  ])("%s → %s", (input, out) => expect(normalizeDomain(input)).toBe(out));
});

describe("dedupeCandidates", () => {
  it("drops companies already in the database, across campaigns", () => {
    const r = dedupeCandidates([cand("Acme", "https://www.acme.com"), cand("Beta", "beta.io")], new Set(["acme.com"]), none);
    expect(r.accepted.map((a) => a.domain)).toEqual(["beta.io"]);
    expect(r.rejected[0]!.reason).toBe("already in database");
  });

  it("keeps one per domain and merges evidence from duplicates in the batch", () => {
    const r = dedupeCandidates([cand("Acme", "acme.com", "https://a/1"), cand("ACME Ltd", "www.acme.com", "https://a/2")], new Set(), none);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]!.evidence.map((e) => e.url)).toEqual(["https://a/1", "https://a/2"]);
  });

  it("treats same company name with a different domain as a duplicate", () => {
    const r = dedupeCandidates([cand("Acme Trading LLC", "acme.ae"), cand("Acme Trading", "acmetrading.com")], new Set(), none);
    expect(r.accepted).toHaveLength(1);
  });

  it("rejects candidates without a real company domain (job boards, directories)", () => {
    const r = dedupeCandidates([cand("Acme", null), cand("Acme", "indeed.com"), cand("Acme", "uk.linkedin.com")], new Set(), none);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected.every((x) => x.reason === "no company domain")).toBe(true);
  });

  it("applies the do-not-contact list", () => {
    const ex = new ExclusionSet([{ kind: "domain", value: "blocked.com" }, { kind: "company", value: "Business Experts MEA" }]);
    const r = dedupeCandidates([cand("X", "blocked.com"), cand("Business Experts MEA FZ LLC", "bemea.ae"), cand("Ok", "ok.com")], new Set(), ex);
    expect(r.accepted.map((a) => a.domain)).toEqual(["ok.com"]);
  });
});
