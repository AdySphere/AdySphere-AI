// Normalisation used by dedupe and exclusions.

const DIRECTORY_DOMAINS = [
  "linkedin.com", "indeed.com", "glassdoor.com", "facebook.com", "instagram.com", "x.com", "twitter.com",
  "youtube.com", "wikipedia.org", "yelp.com", "crunchbase.com", "zoominfo.com", "bayt.com", "naukrigulf.com",
  "gulftalent.com", "reed.co.uk", "totaljobs.com", "monster.com", "ziprecruiter.com", "dice.com",
  "google.com", "bing.com", "apollo.io", "companieshouse.gov.uk", "find-and-update.company-information.service.gov.uk",
  "bloomberg.com", "dnb.com", "yellowpages.com", "yell.com", "clutch.co", "g2.com", "capterra.com",
  "microsoft.com", "appsource.microsoft.com", "medium.com", "reddit.com", "quora.com",
];

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@").pop()!;
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.split(/[/?#]/)[0]!;
  s = s.replace(/:\d+$/, "");
  s = s.replace(/^www\d?\./, "");
  s = s.replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}

export function normalizeCompanyName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(llc|l l c|ltd|limited|inc|incorporated|plc|fze|fzco|fz llc|dmcc|co|corp|corporation|gmbh|pvt|private|llp)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDirectoryDomain(domain: string): boolean {
  return DIRECTORY_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function isLinkedInUrl(url: string): boolean {
  const d = normalizeDomain(url);
  return d !== null && (d === "linkedin.com" || d.endsWith(".linkedin.com"));
}
