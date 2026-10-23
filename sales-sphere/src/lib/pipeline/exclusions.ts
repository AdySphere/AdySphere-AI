import type { ExclusionKind } from "@prisma/client";
import { normalizeCompanyName, normalizeDomain } from "../domain";

export type ExclusionEntry = { kind: ExclusionKind; value: string; reason?: string };

export class ExclusionSet {
  private domains = new Set<string>();
  private names = new Set<string>();

  constructor(entries: ExclusionEntry[]) {
    for (const e of entries) {
      if (e.kind === "domain") {
        const d = normalizeDomain(e.value);
        if (d) this.domains.add(d);
      } else {
        const n = normalizeCompanyName(e.value);
        if (n) this.names.add(n);
      }
    }
  }

  // Blocks the domain itself and any subdomain (blocking acme.com also blocks uk.acme.com).
  isDomainExcluded(domain: string | null | undefined): boolean {
    const d = normalizeDomain(domain);
    if (!d) return false;
    for (const blocked of this.domains) if (d === blocked || d.endsWith(`.${blocked}`)) return true;
    return false;
  }

  isNameExcluded(name: string | null | undefined): boolean {
    const n = normalizeCompanyName(name);
    return n.length > 0 && this.names.has(n);
  }

  check(c: { domain?: string | null; name?: string | null; email?: string | null }): string | null {
    if (this.isDomainExcluded(c.domain)) return "domain is on the do-not-contact list";
    if (c.email && this.isDomainExcluded(c.email)) return "email domain is on the do-not-contact list";
    if (this.isNameExcluded(c.name)) return "company is on the do-not-contact list";
    return null;
  }
}

// Turn a free-text exclusion ("Business Experts MEA", "acme.com") into a stored entry.
export function toExclusionEntry(raw: string): ExclusionEntry | null {
  const t = raw.trim();
  if (!t) return null;
  const asDomain = /\s/.test(t) ? null : normalizeDomain(t);
  if (asDomain) return { kind: "domain", value: asDomain };
  const name = normalizeCompanyName(t);
  return name ? { kind: "company", value: name } : null;
}
