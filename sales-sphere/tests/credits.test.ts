import { describe, expect, it } from "vitest";
import { CreditLimitError, CreditTracker, estimateEnrichmentCredits, type CreditStore } from "@/lib/apollo/credits";
import { ApolloClient, pickDecisionMaker } from "@/lib/apollo/client";
import { MemoryCallLogger } from "@/lib/audit";
import { mockFetch } from "./helpers";

function memoryStore() {
  const entries: { campaignId: string; credits: number; operation: string }[] = [];
  const store: CreditStore = { async add(campaignId, credits, operation) { entries.push({ campaignId, credits, operation }); } };
  return { store, entries };
}

describe("CreditTracker", () => {
  it("records credits per run", async () => {
    const { store, entries } = memoryStore();
    const t = new CreditTracker(store, "c1", 3);
    await t.record(1, "people_match");
    await t.record(1, "people_match");
    expect(t.creditsUsed).toBe(2);
    expect(t.remaining).toBe(1);
    expect(entries).toEqual([{ campaignId: "c1", credits: 1, operation: "people_match" }, { campaignId: "c1", credits: 1, operation: "people_match" }]);
  });

  it("refuses to spend beyond the confirmed budget, before calling the API", async () => {
    const { store } = memoryStore();
    const t = new CreditTracker(store, "c1", 1);
    let called = 0;
    await t.spend(1, "op", async () => (called++, { result: 1, credits: 1 }));
    await expect(t.spend(1, "op", async () => (called++, { result: 1, credits: 1 }))).rejects.toBeInstanceOf(CreditLimitError);
    expect(called).toBe(1);
  });

  it("estimates one credit per contact that still needs an email", () => {
    expect(estimateEnrichmentCredits([{ apolloId: "a" }, { apolloId: "b", email: "x@y.com" }, { apolloId: null }])).toBe(1);
  });
});

describe("ApolloClient (mocked)", () => {
  it("people search is free and enrichment is tracked per credit", async () => {
    const { fetch, calls } = mockFetch((req) => {
      if (req.url.endsWith("/mixed_people/api_search")) {
        return { json: { people: [{ id: "p1", first_name: "Sam", last_name_obfuscated: "K***", title: "Head of IT", has_email: true }, { id: "p2", first_name: "Ana", title: "CFO", has_email: true }] } };
      }
      if (req.url.endsWith("/people/match")) return { json: { person: { id: "p2", email: "ana@acme.com", email_status: "verified", last_name: "Lopez", name: "Ana Lopez" } } };
      return { status: 404 };
    });
    const logger = new MemoryCallLogger();
    const apollo = new ApolloClient({ apiKey: "k", logger, fetch, campaignId: "c1" });
    const people = await apollo.searchPeople({ domain: "acme.com", titles: ["CFO", "Head of IT"] });
    const best = pickDecisionMaker(people, ["CFO", "Head of IT"]);
    expect(best?.id).toBe("p2");

    const { store, entries } = memoryStore();
    const tracker = new CreditTracker(store, "c1", 5);
    const r = await apollo.enrichPerson(best!.id, tracker);
    expect(r).toMatchObject({ email: "ana@acme.com", emailStatus: "verified" });
    expect(tracker.creditsUsed).toBe(1);
    expect(entries).toHaveLength(1);
    expect(calls[0]!.headers["x-api-key"]).toBe("k");
    expect(logger.calls.map((c) => [c.operation, c.cost, c.costUnit])).toEqual([["people_search", 0, "none"], ["people_match", 1, "credits"]]);
  });

  it("does not charge when Apollo finds no person", async () => {
    const { fetch } = mockFetch(() => ({ json: { person: null } }));
    const { store } = memoryStore();
    const tracker = new CreditTracker(store, "c1", 5);
    await new ApolloClient({ apiKey: "k", logger: new MemoryCallLogger(), fetch }).enrichPerson("x", tracker);
    expect(tracker.creditsUsed).toBe(0);
  });
});
