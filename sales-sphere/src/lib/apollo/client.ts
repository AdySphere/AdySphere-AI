import type { CallLogger, FetchLike } from "../audit";
import { normalizeDomain } from "../domain";
import type { CreditTracker } from "./credits";

const BASE = "https://api.apollo.io/api/v1";

export type ApolloPerson = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  title: string | null;
  seniority: string | null;
  hasEmail: boolean | null;
  linkedinUrl: string | null;
};

export type ApolloOrg = {
  id: string;
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  employees: number | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  address: string | null;
};

export type EnrichedPerson = {
  email: string | null;
  emailStatus: string | null; // "verified" | "unverified" | "extrapolated" | "unavailable" | null
  linkedinUrl: string | null;
  phone: string | null;
  lastName: string | null;
  name: string | null;
  title: string | null;
};

export class ApolloClient {
  constructor(private opts: { apiKey: string; logger: CallLogger; campaignId?: string | null; fetch?: FetchLike }) {}

  private async post<T>(path: string, body: unknown, operation: string, cost: number, costUnit: "credits" | "none"): Promise<T> {
    const res = await (this.opts.fetch ?? fetch)(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": this.opts.apiKey },
      body: JSON.stringify(body),
    });
    await this.opts.logger.log({
      provider: "apollo",
      operation,
      cost: res.ok ? cost : 0,
      costUnit,
      status: res.ok ? "ok" : "error",
      campaignId: this.opts.campaignId,
      meta: { status: res.status },
    });
    if (!res.ok) throw new Error(`Apollo ${operation} failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 500));
    return (await res.json()) as T;
  }

  /** People search. Free on Apollo (no credits) and returns no emails. */
  async searchPeople(params: { domain: string; titles: string[]; perPage?: number }): Promise<ApolloPerson[]> {
    type Raw = { people?: Record<string, unknown>[] };
    const data = await this.post<Raw>(
      "/mixed_people/api_search",
      {
        q_organization_domains_list: [params.domain],
        person_titles: params.titles,
        include_similar_titles: true,
        page: 1,
        per_page: params.perPage ?? 10,
      },
      "people_search",
      0,
      "none",
    );
    return (data.people ?? []).map((p) => {
      const first = (p.first_name as string) ?? null;
      const last = (p.last_name as string) ?? (p.last_name_obfuscated as string) ?? null;
      return {
        id: String(p.id),
        firstName: first,
        lastName: last,
        name: (p.name as string) ?? [first, last].filter(Boolean).join(" "),
        title: (p.title as string) ?? null,
        seniority: (p.seniority as string) ?? null,
        hasEmail: typeof p.has_email === "boolean" ? (p.has_email as boolean) : null,
        linkedinUrl: (p.linkedin_url as string) ?? null,
      };
    });
  }

  /** Organisation search. Only used when APOLLO_ORG_SEARCH_ENABLED=true; counted as 1 credit per page. */
  async searchOrganizations(params: { keywords: string[]; locations: string[]; sizeMin?: number | null; sizeMax?: number | null; page?: number; perPage?: number }, tracker: CreditTracker): Promise<ApolloOrg[]> {
    type Raw = { organizations?: Record<string, unknown>[]; accounts?: Record<string, unknown>[] };
    const range = params.sizeMin || params.sizeMax ? [`${params.sizeMin ?? 1},${params.sizeMax ?? 1000000}`] : undefined;
    const data = await tracker.spend(1, "org_search", async () => ({
      result: await this.post<Raw>(
        "/mixed_companies/search",
        {
          q_organization_keyword_tags: params.keywords,
          organization_locations: params.locations,
          organization_num_employees_ranges: range,
          page: params.page ?? 1,
          per_page: params.perPage ?? 25,
        },
        "org_search",
        1,
        "credits",
      ),
      credits: 1,
    }));
    return [...(data.organizations ?? []), ...(data.accounts ?? [])].map((o) => ({
      id: String(o.id),
      name: String(o.name ?? ""),
      domain: normalizeDomain((o.primary_domain as string) ?? (o.website_url as string) ?? (o.domain as string)),
      linkedinUrl: (o.linkedin_url as string) ?? null,
      phone: ((o.primary_phone as { number?: string })?.number ?? (o.phone as string)) || null,
      employees: (o.estimated_num_employees as number) ?? null,
      industry: (o.industry as string) ?? null,
      city: (o.city as string) ?? null,
      state: (o.state as string) ?? null,
      country: (o.country as string) ?? null,
      address: (o.raw_address as string) ?? null,
    }));
  }

  /** Email enrichment: 1 credit per person. */
  async enrichPerson(apolloId: string, tracker: CreditTracker): Promise<EnrichedPerson> {
    return tracker.spend(1, "people_match", async () => {
      type Raw = { person?: Record<string, unknown> | null };
      const data = await this.post<Raw>(
        "/people/match",
        { id: apolloId, reveal_personal_emails: false, reveal_phone_number: false },
        "people_match",
        1,
        "credits",
      );
      const p = data.person ?? null;
      const org = (p?.organization as Record<string, unknown> | undefined) ?? undefined;
      return {
        credits: p ? 1 : 0,
        result: {
          email: (p?.email as string) ?? null,
          emailStatus: (p?.email_status as string) ?? null,
          linkedinUrl: (p?.linkedin_url as string) ?? null,
          phone: ((org?.primary_phone as { number?: string })?.number ?? (org?.phone as string)) || null,
          lastName: (p?.last_name as string) ?? null,
          name: (p?.name as string) ?? null,
          title: (p?.title as string) ?? null,
        },
      };
    }, { apolloId });
  }
}

/** Pick the highest-priority title match. `titles` is in priority order. */
export function pickDecisionMaker(people: ApolloPerson[], titles: string[]): ApolloPerson | null {
  if (people.length === 0) return null;
  const score = (p: ApolloPerson) => {
    const t = (p.title ?? "").toLowerCase();
    const idx = titles.findIndex((want) => t.includes(want.toLowerCase()));
    const base = idx === -1 ? titles.length + 1 : idx;
    return p.hasEmail === false ? base + 100 : base;
  };
  return [...people].sort((a, b) => score(a) - score(b))[0]!;
}
