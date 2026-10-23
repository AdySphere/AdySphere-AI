/**
 * End-to-end pipeline run against a real Postgres, with every external service mocked:
 * Claude prompts, Brave, Apollo, Microsoft Graph and company websites.
 * Runs only when TEST_DATABASE_URL is set. That database is WIPED: never point it at real data.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.ANTHROPIC_API_KEY = "test";
process.env.BRAVE_API_KEY = "test";
process.env.APOLLO_API_KEY = "test";
process.env.SEARCH_PROVIDER = "brave";
process.env.MS_CLIENT_ID = "id";
process.env.MS_CLIENT_SECRET = "secret";

vi.mock("@/lib/claude/prompts", () => ({
  planSearchQueries: vi.fn(async () => [{ q: '"Business Central developer" job Manchester', country: "GB" }]),
  extractCandidates: vi.fn(async () => ({
    companies: [
      { name: "Acme Logistics Ltd", domain: "acme-logistics.co.uk", location: "Manchester, UK", signal: "Hiring a Business Central developer", evidence: [0] },
      { name: "Business Experts MEA", domain: "bemea.example", location: "Dubai", signal: "x", evidence: [1] },
      { name: "Gamma Foods", domain: "gammafoods.co.uk", location: "London", signal: "Hiring Power BI analyst", evidence: [2] },
      { name: "No Evidence Co", domain: "noevidence.co.uk", location: null, signal: "made up", evidence: [] },
    ],
  })),
  scoreCompanies: vi.fn(async (_c: unknown, p: { companies: { id: string; name: string }[] }) =>
    p.companies.map((c) => ({
    id: c.id, score: 88, tier: "hot", why_now: `${c.name} is hiring a BC developer (job post).`, signal: "BC developer job", pitch: "Contract cover while they hire",
      confidence: "high", disqualify_reason: null, industry: "Logistics", size_label: null,
    })),
  ),
  writeEmail: vi.fn(async () => ({
    subject: "your business central role",
    body:
      "Hi Ana,\n\nSaw you're hiring a Business Central developer in Manchester. When a team posts that role, the backlog of reports, integrations and small fixes is usually already piling up, and the hire can take months to land.\n\nI'm a Microsoft AI Cloud Partner and I run D365 implementations myself, so I can cover the work from next week while you recruit, then hand over cleanly once your new developer starts.\n\nWorth a quick chat next week to see what's sitting in the queue? Fifteen minutes is plenty.",
  })),
  writeFollowUp: vi.fn(),
  classifyReply: vi.fn(),
  draftListTypeConfig: vi.fn(),
}));

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
if (hasDb) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const graphCalls: { method: string; url: string; body: unknown }[] = [];

function route(url: string, init?: RequestInit): Response {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://api.search.brave.com/")) {
    return json({ web: { results: [
      { title: "Business Central Developer - Acme Logistics", url: "https://acme-logistics.co.uk/careers/bc-developer", description: "Acme Logistics is hiring a Business Central developer in Manchester" },
      { title: "BEMEA", url: "https://bemea.example/", description: "Business Experts MEA" },
      { title: "Power BI analyst - Gamma Foods", url: "https://gammafoods.co.uk/jobs", description: "Gamma Foods hiring" },
      { title: "LinkedIn job", url: "https://uk.linkedin.com/jobs/view/123", description: "should be ignored" },
    ] } });
  }
  if (url.endsWith("/mixed_people/api_search")) return json({ people: [{ id: "ap1", first_name: "Ana", last_name_obfuscated: "L***", title: "Finance Director", has_email: true }] });
  if (url.endsWith("/people/match")) return json({ person: { id: "ap1", first_name: "Ana", last_name: "Lopez", name: "Ana Lopez", email: "ana@acme-logistics.co.uk", email_status: "verified", title: "Finance Director" } });
  if (url.startsWith("https://graph.microsoft.com/")) {
    graphCalls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (init?.method === "POST" && url.endsWith("/me/messages")) return json({ id: `MSG${graphCalls.length}`, conversationId: "CONV1", subject: "x" }, 201);
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json({}, 404);
  }
  if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200 });
  if (/^https:\/\/[^/]+\/?$/.test(url)) return new Response("<html><body>We move freight across the North West.</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  return new Response("not mocked", { status: 500 });
}

describe.skipIf(!hasDb)("campaign pipeline (integration)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let run: typeof import("@/lib/pipeline/run");
  let encrypt: typeof import("@/lib/crypto").encrypt;

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => route(String(input), init)));
    ({ prisma } = await import("@/lib/db"));
    run = await import("@/lib/pipeline/run");
    ({ encrypt } = await import("@/lib/crypto"));
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Draft","Contact","Prospect","CampaignLog","ExternalCall","Campaign","Company","Exclusion","Region","ListType","Mailbox","ProofPoint","VoiceExample","Setting" CASCADE',
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.$disconnect();
  });

  it("finds, dedupes, excludes, asks before credits, enriches, writes and creates the Outlook draft", async () => {
    const { DEFAULT_LIST_TYPES } = await import("@/lib/listTypes/defaults");
    const lt = DEFAULT_LIST_TYPES.find((l) => l.slug === "warm-hiring")!;
    const mailbox = await prisma.mailbox.create({
      data: {
        email: "mallicka@adysphere.com", displayName: "Adyasha Mallick", personaName: "Adyasha", signatureHtml: "<table><tr><td>AdySphere Co</td></tr></table>",
        encryptedRefreshToken: encrypt("rt"), accessToken: encrypt("at"), accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const region = await prisma.region.create({
      data: {
        name: "UK", timeZone: "Europe/London", currency: "GBP", spelling: "en-GB", defaultMailboxId: mailbox.id,
        complianceFooter: 'If this isn\'t relevant, just reply "no thanks" and I won\'t contact you again.',
        locations: [{ label: "Manchester, England, United Kingdom", query: "Manchester", kind: "city", lat: 53.48, lon: -2.24, countryCode: "GB" }],
      },
    });
    const listType = await prisma.listType.create({ data: { slug: lt.slug, name: lt.name, config: lt.config } });
    await prisma.exclusion.create({ data: { kind: "company", value: "business experts mea", reason: "blocked" } });
    // Gamma is already a prospect in an earlier campaign (possibly another mailbox).
    const old = await prisma.campaign.create({ data: { regionId: region.id, listTypeId: listType.id, targetCount: 1, status: "completed" } });
    const gamma = await prisma.company.create({ data: { domain: "gammafoods.co.uk", name: "Gamma Foods" } });
    await prisma.prospect.create({ data: { campaignId: old.id, companyId: gamma.id, status: "sent" } });

    const c = await prisma.campaign.create({ data: { regionId: region.id, listTypeId: listType.id, targetCount: 2 } });
    await run.runCampaign(c.id);

    let cur = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(cur.error).toBeNull();
    expect(cur.status).toBe("awaiting_enrich_confirmation");
    expect(cur.estimatedCredits).toBe(1);
    expect(cur.creditsUsed).toBe(0);

    const prospects = await prisma.prospect.findMany({ where: { campaignId: c.id }, include: { company: true } });
    expect(prospects.map((p) => p.company.domain)).toEqual(["acme-logistics.co.uk"]);

    await run.confirmCampaign(c.id, "enrich");
    await run.runCampaign(c.id);
    cur = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(cur.error).toBeNull();
    expect(cur.status).toBe("completed");
    expect(cur.creditsUsed).toBe(1);

    const draft = await prisma.draft.findFirstOrThrow({ where: { prospect: { campaignId: c.id } } });
    expect(draft).toMatchObject({ toEmail: "ana@acme-logistics.co.uk", graphMessageId: expect.stringMatching(/^MSG/), conversationId: "CONV1", status: "pending_review" });
    expect(draft.scheduledFor).toBeInstanceOf(Date);

    const create = graphCalls.find((g) => g.method === "POST" && g.url.endsWith("/me/messages"))!;
    const html = (create.body as { body: { content: string } }).body.content;
    expect(html).toContain("Best,<br>Adyasha");
    expect(html).toContain("AdySphere Co");
    expect(html).toContain("no thanks");
    expect(graphCalls.some((g) => g.url.endsWith("/send"))).toBe(false);

    const calls = await prisma.externalCall.groupBy({ by: ["provider"], _count: true });
    expect(calls.map((x) => x.provider).sort()).toEqual(expect.arrayContaining(["apollo", "brave", "graph", "web"]));
    expect(graphCalls.some((g) => g.url.includes("linkedin"))).toBe(false);

    // Reject in review → company goes on the do-not-contact list and the Outlook draft is deleted.
    const { rejectDraft } = await import("@/lib/drafts/service");
    await rejectDraft(draft.id);
    expect(await prisma.exclusion.findFirst({ where: { value: "acme-logistics.co.uk", reason: "rejected" } })).not.toBeNull();
    expect(graphCalls.some((g) => g.method === "DELETE")).toBe(true);

    // A second run finds the same companies but adds nobody: all deduped or excluded.
    const c2 = await prisma.campaign.create({ data: { regionId: region.id, listTypeId: listType.id, targetCount: 2 } });
    await run.runCampaign(c2.id);
    expect(await prisma.prospect.count({ where: { campaignId: c2.id } })).toBe(0);
  });
});
