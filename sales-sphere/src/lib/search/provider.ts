import type { CallLogger, FetchLike } from "../audit";

export type SearchResult = { title: string; url: string; snippet: string };

export interface SearchProvider {
  name: string;
  search(query: string, opts?: { country?: string; count?: number }): Promise<SearchResult[]>;
}

export class BraveSearch implements SearchProvider {
  name = "brave";
  constructor(private opts: { apiKey: string; logger: CallLogger; usdPerQuery: number; campaignId?: string | null; fetch?: FetchLike }) {}

  async search(query: string, o: { country?: string; count?: number } = {}): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, count: String(o.count ?? 20) });
    // Brave accepts a 2-letter country code; "ALL" otherwise. UK is "GB".
    if (o.country) params.set("country", o.country.toUpperCase());
    const res = await (this.opts.fetch ?? fetch)(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { Accept: "application/json", "X-Subscription-Token": this.opts.apiKey },
    });
    await this.opts.logger.log({
      provider: "brave",
      operation: "web_search",
      cost: res.ok ? this.opts.usdPerQuery : 0,
      costUnit: "usd",
      status: res.ok ? "ok" : "error",
      campaignId: this.opts.campaignId,
      meta: { query },
    });
    if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
    const data = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
    return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: (r.description ?? "").replace(/<[^>]+>/g, "") }));
  }
}

export class NoSearch implements SearchProvider {
  name = "none";
  async search(): Promise<SearchResult[]> {
    return [];
  }
}
