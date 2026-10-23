import { normalizeCompanyName, normalizeDomain, isDirectoryDomain } from "../domain";
import type { ExclusionSet } from "./exclusions";

export type Candidate = {
  name: string;
  domain: string | null;
  signal: string;
  evidence: { url: string; title?: string; snippet?: string }[];
  location?: string;
  apolloOrgId?: string;
  phone?: string;
  address?: string;
  linkedinUrl?: string;
  industry?: string;
  sizeLabel?: string;
};

export type DedupeResult = {
  accepted: (Candidate & { domain: string })[];
  rejected: { candidate: Candidate; reason: string }[];
};

/**
 * Keeps one candidate per domain. Drops anything without a usable company domain, anything already
 * in the database (any campaign, any mailbox), and anything on the do-not-contact list.
 * Evidence from duplicate candidates in the same batch is merged into the first one.
 */
export function dedupeCandidates(
  candidates: Candidate[],
  knownDomains: Set<string>,
  exclusions: ExclusionSet,
): DedupeResult {
  const accepted = new Map<string, Candidate & { domain: string }>();
  const seenNames = new Map<string, string>();
  const rejected: DedupeResult["rejected"] = [];

  for (const c of candidates) {
    const domain = normalizeDomain(c.domain);
    if (!domain || isDirectoryDomain(domain)) {
      rejected.push({ candidate: c, reason: "no company domain" });
      continue;
    }
    const excluded = exclusions.check({ domain, name: c.name });
    if (excluded) {
      rejected.push({ candidate: c, reason: excluded });
      continue;
    }
    if (knownDomains.has(domain)) {
      rejected.push({ candidate: c, reason: "already in database" });
      continue;
    }
    const existing = accepted.get(domain) ?? accepted.get(seenNames.get(normalizeCompanyName(c.name)) ?? "");
    if (existing) {
      const urls = new Set(existing.evidence.map((e) => e.url));
      for (const e of c.evidence) if (!urls.has(e.url)) existing.evidence.push(e);
      rejected.push({ candidate: c, reason: "duplicate in this batch" });
      continue;
    }
    accepted.set(domain, { ...c, domain, evidence: [...c.evidence] });
    const n = normalizeCompanyName(c.name);
    if (n) seenNames.set(n, domain);
  }
  return { accepted: [...accepted.values()], rejected };
}
