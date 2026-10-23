import { Prisma, type Campaign, type ListType, type Mailbox, type Region } from "@prisma/client";
import { prisma } from "../db";
import { dbCallLogger, type CallLogger } from "../audit";
import { env } from "../env";
import { getSettings, type AppSettings } from "../settings";
import { Claude } from "../claude/client";
import { extractCandidates, planSearchQueries, scoreCompanies } from "../claude/prompts";
import { parseListTypeConfig, type ListTypeConfig } from "../listTypes/schema";
import { BraveSearch, NoSearch, type SearchProvider, type SearchResult } from "../search/provider";
import { fetchPageText } from "../search/fetchPage";
import { ApolloClient, pickDecisionMaker } from "../apollo/client";
import { CreditLimitError, CreditTracker, estimateEnrichmentCredits, type CreditStore } from "../apollo/credits";
import { isDirectoryDomain, isLinkedInUrl, normalizeDomain } from "../domain";
import { locationSearchLabel, type RegionLocation } from "../geo/regions";
import { ExclusionSet, toExclusionEntry, type ExclusionEntry } from "./exclusions";
import { dedupeCandidates, type Candidate } from "./dedupe";
import { nextLocalMorning } from "./schedule";
import { loadWriterContext, writeCheckedEmail } from "../drafts/writer";
import { pushDraftToOutlook } from "../drafts/service";
import { DailyCapError, FooterIncompleteError } from "../drafts/outlook";
import { isConnected } from "../graph/factory";
import type { Evidence } from "./types";

type FullCampaign = Campaign & { region: Region & { defaultMailbox: Mailbox | null }; listType: ListType; mailbox: Mailbox | null };

const MAX_ROUNDS = 4;
// Rough per-prospect Claude cost used only for the pre-run estimate (USD).
const CLAUDE_USD_PER_PROSPECT = 0.06;

export async function log(campaignId: string, message: string, level: "info" | "warn" | "error" = "info") {
  await prisma.campaignLog.create({ data: { campaignId, message, level } });
}

const dbCreditStore: CreditStore = {
  async add(campaignId, credits) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { creditsUsed: { increment: credits } } });
  },
};

async function load(campaignId: string): Promise<FullCampaign> {
  return prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { region: { include: { defaultMailbox: true } }, listType: true, mailbox: true },
  });
}

async function setStatus(campaignId: string, status: Campaign["status"], extra: Prisma.CampaignUpdateInput = {}) {
  await prisma.campaign.update({ where: { id: campaignId }, data: { status, ...extra } });
}

export function estimateRun(targetCount: number, settings: AppSettings) {
  const queries = Math.min(12, Math.ceil(targetCount / 3) + 2) * 2 + Math.ceil(targetCount / 2); // plan rounds + domain lookups
  const braveUsd = env.searchProvider() === "brave" ? queries * settings.braveUsdPerQuery : 0;
  const claudeUsd = targetCount * CLAUDE_USD_PER_PROSPECT;
  const apolloOrgCredits = env.apolloOrgSearchEnabled() ? 2 : 0;
  return { queries, braveUsd, claudeUsd, totalUsd: braveUsd + claudeUsd, apolloOrgCredits };
}

/**
 * Advance a campaign as far as it can go without asking the user.
 * Safe to call repeatedly: it resumes from the stored status.
 */
export async function runCampaign(campaignId: string, opts: { logger?: CallLogger } = {}) {
  const logger = opts.logger ?? dbCallLogger;
  try {
    let c = await load(campaignId);
    const settings = await getSettings();

    if (c.status === "created") {
      if (!env.hasAnthropic()) throw new Error("ANTHROPIC_API_KEY is not set");
      const est = estimateRun(c.targetCount, settings);
      await prisma.campaign.update({ where: { id: c.id }, data: { estimatedUsd: est.totalUsd } });
      const msg = `Estimated spend: ~$${est.totalUsd.toFixed(2)} (about ${est.queries} Brave queries ≈ $${est.braveUsd.toFixed(2)}, Claude ≈ $${est.claudeUsd.toFixed(2)}${est.apolloOrgCredits ? `, Apollo org search ≈ ${est.apolloOrgCredits} credits` : ""}). Email enrichment is estimated separately before it runs.`;
      await log(c.id, msg);
      if (est.totalUsd > settings.confirmAboveUsd || est.apolloOrgCredits > 0) {
        await setStatus(c.id, "awaiting_run_confirmation", { pendingConfirmation: { stage: "run", message: msg, estimate: est } });
        await log(c.id, `Waiting for your confirmation: estimate is over your $${settings.confirmAboveUsd} budget or uses Apollo credits.`, "warn");
        return;
      }
      await setStatus(c.id, "discovering");
      c = await load(campaignId);
    }

    if (c.status === "discovering") {
      await discover(c, settings, logger);
      await findContacts(await load(campaignId), logger);
      const contacts = await prisma.contact.findMany({ where: { prospect: { campaignId } } });
      const credits = estimateEnrichmentCredits(contacts);
      await prisma.campaign.update({ where: { id: campaignId }, data: { estimatedCredits: credits } });
      if (credits === 0) {
        await log(campaignId, "No contacts need email enrichment.");
        await setStatus(campaignId, "writing");
      } else {
        const msg = `Email enrichment needs about ${credits} Apollo credits (1 per contact). Confirm to spend them.`;
        await log(campaignId, msg, "warn");
        if (credits > settings.confirmAboveCredits) {
          await setStatus(campaignId, "awaiting_enrich_confirmation", { pendingConfirmation: { stage: "enrich", message: msg, estimate: { credits } } });
          return;
        }
        await setStatus(campaignId, "enriching", { pendingConfirmation: { stage: "enrich", approvedCredits: credits } });
      }
      c = await load(campaignId);
    }

    if (c.status === "enriching") {
      const approved = Number((c.pendingConfirmation as { approvedCredits?: number } | null)?.approvedCredits ?? 0);
      await enrich(c, approved, logger);
      await setStatus(campaignId, "writing", { pendingConfirmation: Prisma.DbNull });
      c = await load(campaignId);
    }

    if (c.status === "writing") {
      await writeDrafts(c, settings, logger);
      await setStatus(campaignId, "completed");
      await log(campaignId, "Campaign complete. Drafts are in the review queue.");
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await log(campaignId, `Failed: ${message}`, "error");
    await setStatus(campaignId, "failed", { error: message });
  }
}

/** Called from the UI/CLI when the user confirms a pending stage. */
export async function confirmCampaign(campaignId: string, stage: "run" | "enrich", approvedCredits?: number) {
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (stage === "run") {
    if (c.status !== "awaiting_run_confirmation") throw new Error(`Campaign is ${c.status}, not awaiting run confirmation`);
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "discovering", pendingConfirmation: Prisma.DbNull } });
    await log(campaignId, "Run confirmed.");
  } else {
    if (c.status !== "awaiting_enrich_confirmation") throw new Error(`Campaign is ${c.status}, not awaiting enrichment confirmation`);
    const credits = approvedCredits ?? c.estimatedCredits;
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "enriching", pendingConfirmation: { stage: "enrich", approvedCredits: credits } } });
    await log(campaignId, `Enrichment confirmed for up to ${credits} credits.`);
  }
}

export async function skipEnrichment(campaignId: string) {
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "writing", pendingConfirmation: Prisma.DbNull } });
  await prisma.prospect.updateMany({ where: { campaignId, status: "contact_found" }, data: { status: "linkedin_phone_only" } });
  await log(campaignId, "Enrichment skipped. Contacts without an email are marked LinkedIn/phone only.", "warn");
}

// ---------------- Stage 1-4: find, qualify, dedupe, exclude ----------------

function makeSearch(settings: AppSettings, logger: CallLogger, campaignId: string): SearchProvider {
  if (env.searchProvider() === "brave" && env.hasBrave()) {
    return new BraveSearch({ apiKey: env.braveApiKey(), logger, usdPerQuery: settings.braveUsdPerQuery, campaignId });
  }
  return new NoSearch();
}

async function discover(c: FullCampaign, settings: AppSettings, logger: CallLogger) {
  const config = parseListTypeConfig(c.listType.config);
  if (config.needsVerticalText && !c.verticalText) throw new Error("This list type needs a vertical (e.g. 'dental groups')");
  const claude = new Claude({ logger, campaignId: c.id });
  const search = makeSearch(settings, logger, c.id);
  const locations = c.region.locations as unknown as RegionLocation[];
  if (search.name === "none" && !(env.apolloOrgSearchEnabled() && env.hasApollo())) {
    throw new Error("No discovery source: set BRAVE_API_KEY or enable Apollo organisation search");
  }

  const exclusions = new ExclusionSet(await prisma.exclusion.findMany());
  // Named exclusions on the list type ("Business Experts MEA", "acme.com") are enforced here;
  // descriptive ones ("Microsoft partners and IT consultancies") are applied by Claude when scoring.
  const listExclusions = new ExclusionSet(
    config.exclusions
      .filter((x) => x.split(/\s+/).length <= 4 && !/\b(companies|partners|agencies|consultancies|customers|already|large|any)\b/i.test(x))
      .map(toExclusionEntry)
      .filter((x): x is ExclusionEntry => x !== null),
  );

  const usedQueries: string[] = [];
  let qualified = await prisma.prospect.count({ where: { campaignId: c.id, status: { not: "disqualified" } } });
  await log(c.id, `Looking for ${c.targetCount} ${c.listType.name} prospects in ${c.region.name}${c.verticalText ? ` (${c.verticalText})` : ""}.`);

  for (let round = 1; round <= MAX_ROUNDS && qualified < c.targetCount; round++) {
    const remaining = c.targetCount - qualified;
    const candidates: Candidate[] = [];

    if (search.name !== "none") {
      const queries = await planSearchQueries(claude, {
        listName: c.listType.name,
        config,
        verticalText: c.verticalText,
        locations: locations.map((l) => ({ label: locationSearchLabel(l), countryCode: l.countryCode })),
        count: Math.min(12, Math.ceil(remaining / 3) + 2),
        alreadyUsed: usedQueries,
      });
      await log(c.id, `Round ${round}: running ${queries.length} searches.`);
      const results: SearchResult[] = [];
      const seenUrls = new Set<string>();
      for (const q of queries) {
        usedQueries.push(q.q);
        try {
          for (const r of await search.search(q.q, { country: q.country || locations[0]?.countryCode, count: 20 })) {
            // No LinkedIn: we neither fetch nor cite it.
            if (seenUrls.has(r.url) || isLinkedInUrl(r.url)) continue;
            seenUrls.add(r.url);
            results.push(r);
          }
        } catch (e) {
          await log(c.id, `Search failed for "${q.q}": ${(e as Error).message}`, "warn");
        }
      }
      for (let i = 0; i < results.length; i += 40) {
        const chunk = results.slice(i, i + 40);
        const { companies } = await extractCandidates(claude, { listName: c.listType.name, config, verticalText: c.verticalText, results: chunk });
        for (const co of companies) {
          const evidence = co.evidence.map((idx) => chunk[idx]).filter(Boolean).map((r) => ({ url: r!.url, title: r!.title, snippet: r!.snippet }));
          if (evidence.length === 0) continue; // nothing to back it up
          const fromUrl = evidence.map((e) => normalizeDomain(e.url)).find((d) => d && !isDirectoryDomain(d)) ?? null;
          candidates.push({ name: co.name, domain: normalizeDomain(co.domain) ?? fromUrl, signal: co.signal, evidence, location: co.location ?? undefined });
        }
      }
      // Resolve missing domains with one search each (job-board finds usually lack one).
      let lookups = 0;
      for (const cand of candidates) {
        if (cand.domain || lookups >= Math.ceil(remaining / 2) + 5) continue;
        lookups++;
        try {
          const hits = await search.search(`${cand.name} ${cand.location ?? ""} official website`.trim(), { country: locations[0]?.countryCode, count: 5 });
          const hit = hits.find((h) => {
            const d = normalizeDomain(h.url);
            return d && !isDirectoryDomain(d);
          });
          if (hit) cand.domain = normalizeDomain(hit.url);
        } catch {
          /* leave unresolved */
        }
      }
    }

    if (round === 1 && env.apolloOrgSearchEnabled() && env.hasApollo()) {
      const apollo = new ApolloClient({ apiKey: env.apolloApiKey(), logger, campaignId: c.id });
      const tracker = new CreditTracker(dbCreditStore, c.id, 2);
      try {
        const orgs = await apollo.searchOrganizations(
          { keywords: [...config.industries, ...config.searchKeywords, ...(c.verticalText ? [c.verticalText] : [])].slice(0, 10), locations: locations.map((l) => l.label.split(",").slice(0, 2).join(",")), sizeMin: config.sizeMin, sizeMax: config.sizeMax },
          tracker,
        );
        for (const o of orgs) {
          candidates.push({
            name: o.name,
            domain: o.domain,
            signal: `Apollo match: ${[o.industry, o.employees ? `${o.employees} staff` : null, o.city].filter(Boolean).join(", ")}`,
            evidence: [{ url: o.domain ? `https://${o.domain}` : o.linkedinUrl ?? "https://app.apollo.io", title: "Apollo organisation search", snippet: [o.industry, o.employees ? `~${o.employees} employees` : null, o.address].filter(Boolean).join(" · ") }],
            location: [o.city, o.state, o.country].filter(Boolean).join(", "),
            apolloOrgId: o.id,
            phone: o.phone ?? undefined,
            address: o.address ?? undefined,
            industry: o.industry ?? undefined,
            sizeLabel: o.employees ? `~${o.employees}` : undefined,
          });
        }
        await log(c.id, `Apollo organisation search added ${orgs.length} candidates.`);
      } catch (e) {
        await log(c.id, `Apollo organisation search skipped: ${(e as Error).message}`, "warn");
      }
    }

    const known = new Set((await prisma.company.findMany({ where: { prospect: { isNot: null } }, select: { domain: true } })).map((x) => x.domain));
    const { accepted, rejected } = dedupeCandidates(candidates, known, exclusions);
    const fresh = accepted.filter((a) => {
      const why = listExclusions.check({ domain: a.domain, name: a.name });
      if (why) rejected.push({ candidate: a, reason: `list exclusion: ${why}` });
      return !why;
    });
    const reasons = rejected.reduce<Record<string, number>>((acc, r) => ((acc[r.reason] = (acc[r.reason] ?? 0) + 1), acc), {});
    await log(c.id, `Round ${round}: ${candidates.length} candidates, ${fresh.length} new. Skipped: ${Object.entries(reasons).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}.`);
    if (fresh.length === 0) continue;

    // Short homepage extract for context (robots.txt respected).
    const withText = [] as (Candidate & { domain: string; pageText: string | null; id: string })[];
    for (const [i, a] of fresh.entries()) {
      withText.push({ ...a, id: String(i), pageText: await fetchPageText(`https://${a.domain}`, logger) });
    }

    for (let i = 0; i < withText.length && qualified < c.targetCount; i += 8) {
      const batch = withText.slice(i, i + 8);
      const scores = await scoreCompanies(claude, { listName: c.listType.name, config, verticalText: c.verticalText, regionName: c.region.name, companies: batch });
      const ranked = scores
        .map((s) => ({ s, cand: batch.find((b) => b.id === s.id) }))
        .filter((x): x is { s: (typeof scores)[number]; cand: (typeof batch)[number] } => Boolean(x.cand))
        .sort((a, b) => b.s.score - a.s.score);
      for (const { s, cand } of ranked) {
        if (s.disqualify_reason || s.tier === "cold") {
          await log(c.id, `Skipped ${cand.name} (${s.score}, ${s.tier}): ${s.disqualify_reason ?? s.why_now}`);
          continue;
        }
        if (qualified >= c.targetCount) break;
        try {
          await prisma.$transaction(async (tx) => {
            const company = await tx.company.upsert({
              where: { domain: cand.domain },
              create: {
                domain: cand.domain, name: cand.name, location: cand.location, area: areaOf(cand.location), industry: s.industry ?? cand.industry,
                sizeLabel: s.size_label ?? cand.sizeLabel, phone: cand.phone, address: cand.address, apolloOrgId: cand.apolloOrgId, linkedinUrl: cand.linkedinUrl,
              },
              update: {},
            });
            await tx.prospect.create({
              data: {
                campaignId: c.id, companyId: company.id, score: s.score, tier: s.tier, whyNow: s.why_now, signal: s.signal, pitch: s.pitch,
                confidence: s.confidence, evidence: cand.evidence as Prisma.InputJsonValue, status: "qualified",
              },
            });
          });
          qualified++;
          await log(c.id, `Qualified ${cand.name} (${cand.domain}): ${s.tier.toUpperCase()} ${s.score}. ${s.why_now}`);
        } catch (e) {
          // Unique violation on Prospect.companyId: another campaign took it first.
          if ((e as { code?: string }).code === "P2002") await log(c.id, `Skipped ${cand.name}: already claimed by another campaign.`);
          else throw e;
        }
      }
    }
  }
  await log(c.id, `Discovery finished: ${qualified} of ${c.targetCount} prospects qualified.`, qualified < c.targetCount ? "warn" : "info");
}

function areaOf(location?: string | null) {
  return location ? location.split(",")[0]!.trim() : null;
}

// ---------------- Stage 5: decision-maker (free people search) ----------------

async function findContacts(c: FullCampaign, logger: CallLogger) {
  const prospects = await prisma.prospect.findMany({ where: { campaignId: c.id, status: "qualified" }, include: { company: true } });
  if (!env.hasApollo()) {
    await log(c.id, "APOLLO_API_KEY not set: skipping contact search.", "warn");
    await prisma.prospect.updateMany({ where: { campaignId: c.id, status: "qualified" }, data: { status: "no_contact" } });
    return;
  }
  const config = parseListTypeConfig(c.listType.config);
  const apollo = new ApolloClient({ apiKey: env.apolloApiKey(), logger, campaignId: c.id });
  for (const p of prospects) {
    try {
      const people = await apollo.searchPeople({ domain: p.company.domain, titles: config.titles });
      const best = pickDecisionMaker(people, config.titles);
      if (!best) {
        await prisma.prospect.update({ where: { id: p.id }, data: { status: "no_contact" } });
        await log(c.id, `${p.company.name}: no decision-maker found.`);
        continue;
      }
      await prisma.contact.create({
        data: {
          companyId: p.companyId, prospectId: p.id, apolloId: best.id, firstName: best.firstName, lastName: best.lastName,
          name: best.name || [best.firstName, best.lastName].filter(Boolean).join(" "), title: best.title, linkedinUrl: best.linkedinUrl,
        },
      });
      await prisma.prospect.update({ where: { id: p.id }, data: { status: "contact_found" } });
      await log(c.id, `${p.company.name}: contact ${best.firstName ?? best.name} (${best.title ?? "no title"}).`);
    } catch (e) {
      await log(c.id, `${p.company.name}: people search failed: ${(e as Error).message}`, "warn");
    }
  }
}

// ---------------- Stage 6: email enrichment (credits) ----------------

async function enrich(c: FullCampaign, approvedCredits: number, logger: CallLogger) {
  const apollo = new ApolloClient({ apiKey: env.apolloApiKey(), logger, campaignId: c.id });
  const tracker = new CreditTracker(dbCreditStore, c.id, approvedCredits);
  const exclusions = new ExclusionSet(await prisma.exclusion.findMany());
  const contacts = await prisma.contact.findMany({ where: { prospect: { campaignId: c.id, status: "contact_found" } }, include: { prospect: true, company: true } });
  for (const ct of contacts) {
    if (!ct.apolloId || ct.email) continue;
    try {
      const r = await apollo.enrichPerson(ct.apolloId, tracker);
      const verified = r.email && r.emailStatus === "verified";
      const excluded = r.email ? exclusions.check({ email: r.email }) : null;
      await prisma.contact.update({
        where: { id: ct.id },
        data: {
          email: verified && !excluded ? r.email : null, emailStatus: r.emailStatus ?? "unavailable", linkedinUrl: r.linkedinUrl ?? ct.linkedinUrl,
          phone: r.phone, lastName: r.lastName ?? ct.lastName, name: r.name ?? ct.name, title: r.title ?? ct.title, enrichedAt: new Date(),
        },
      });
      if (r.phone && !ct.company.phone) await prisma.company.update({ where: { id: ct.companyId }, data: { phone: r.phone } });
      if (!verified || excluded) {
        await prisma.prospect.update({ where: { id: ct.prospectId! }, data: { status: "linkedin_phone_only" } });
        await log(c.id, `${ct.company.name}: ${excluded ? excluded : "no verified email"}, marked LinkedIn/phone only.`);
      }
    } catch (e) {
      if (e instanceof CreditLimitError) {
        await log(c.id, `Stopped enrichment: ${e.message}.`, "warn");
        break;
      }
      await log(c.id, `${ct.company.name}: enrichment failed: ${(e as Error).message}`, "warn");
    }
  }
  await prisma.prospect.updateMany({ where: { campaignId: c.id, status: "contact_found", contact: { email: null } }, data: { status: "linkedin_phone_only" } });
  await log(c.id, `Enrichment used ${tracker.creditsUsed} Apollo credits.`);
}

// ---------------- Stage 7-8: write + Outlook draft ----------------

async function writeDrafts(c: FullCampaign, settings: AppSettings, logger: CallLogger) {
  const mailbox = c.mailbox ?? c.region.defaultMailbox;
  if (!mailbox) throw new Error(`No mailbox for region ${c.region.name}. Set a default mailbox in Settings → Regions.`);
  const config: ListTypeConfig = parseListTypeConfig(c.listType.config);
  const claude = new Claude({ logger, campaignId: c.id });
  const ctx = await loadWriterContext({ mailbox, region: c.region, config });
  const prospects = await prisma.prospect.findMany({
    where: { campaignId: c.id, status: "contact_found", contact: { email: { not: null } }, drafts: { none: {} } },
    include: { company: true, contact: true },
    orderBy: { score: "desc" },
  });
  let pushToOutlook = isConnected(mailbox);
  if (!pushToOutlook) await log(c.id, `${mailbox.email} is not connected: drafts stay in the review queue until you connect it.`, "warn");

  for (const p of prospects) {
    const contact = p.contact!;
    const email = await writeCheckedEmail(claude, ctx, {
      listName: c.listType.name,
      config,
      company: { name: p.company.name, domain: p.company.domain, location: p.company.location },
      contact: { firstName: contact.firstName, name: contact.name, title: contact.title },
      whyNow: p.whyNow ?? "",
      signal: p.signal ?? "",
      pitch: p.pitch ?? "",
      evidence: (p.evidence as Evidence[]) ?? [],
    });
    if (email.problems.length) await log(c.id, `${p.company.name}: draft still breaks rules (${email.problems.join(" ")}). Check it in review.`, "warn");
    const draft = await prisma.draft.create({
      data: {
        prospectId: p.id, mailboxId: mailbox.id, kind: "initial", subject: email.subject, body: email.body, originalBody: email.body,
        toEmail: contact.email!, scheduledFor: nextLocalMorning(new Date(), c.region.timeZone, settings.sendTimeLocal),
      },
    });
    await prisma.prospect.update({ where: { id: p.id }, data: { status: "drafted" } });
    if (pushToOutlook) {
      try {
        await pushDraftToOutlook(draft.id, logger);
        await log(c.id, `${p.company.name}: Outlook draft created in ${mailbox.email}.`);
      } catch (e) {
        if (e instanceof DailyCapError || e instanceof FooterIncompleteError) {
          pushToOutlook = false;
          await log(c.id, `${e.message}. Remaining drafts stay in the review queue.`, "warn");
        } else {
          await log(c.id, `${p.company.name}: Outlook draft failed: ${(e as Error).message}`, "warn");
        }
      }
    } else {
      await log(c.id, `${p.company.name}: draft written (review queue).`);
    }
  }
}
