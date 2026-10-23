import type { CallLogger, FetchLike } from "../audit";
import type { RegionLocation } from "./regions";

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  addresstype?: string;
  type?: string;
  address?: Record<string, string>;
};

let lastCall = 0;

// Nominatim usage policy: max 1 request/second, identify the app with a contact address.
export class Nominatim {
  constructor(
    private opts: { baseUrl: string; contactEmail: string; logger: CallLogger; fetch?: FetchLike },
  ) {}

  async search(query: string, limit = 5): Promise<Omit<RegionLocation, "query" | "radiusKm">[]> {
    const wait = 1100 - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const url = `${this.opts.baseUrl}/search?${new URLSearchParams({
      q: query,
      format: "jsonv2",
      addressdetails: "1",
      limit: String(limit),
      "accept-language": "en",
    })}`;
    const res = await (this.opts.fetch ?? fetch)(url, {
      headers: { "User-Agent": `SalesSphere/0.1 (${this.opts.contactEmail})` },
    });
    await this.opts.logger.log({ provider: "nominatim", operation: "search", costUnit: "none", status: res.ok ? "ok" : "error", meta: { query } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const rows = (await res.json()) as NominatimResult[];
    return rows.map((r) => {
      const a = r.address ?? {};
      const kindRaw = r.addresstype ?? r.type ?? "";
      const kind: RegionLocation["kind"] =
        kindRaw === "country" ? "country" : kindRaw === "state" || kindRaw === "province" || kindRaw === "region" ? "state" : ["city", "town", "village", "municipality", "suburb", "county"].includes(kindRaw) ? "city" : "place";
      return {
        label: r.display_name,
        kind,
        lat: Number(r.lat),
        lon: Number(r.lon),
        countryCode: (a.country_code ?? "").toUpperCase(),
        state: a.state,
        city: a.city ?? a.town ?? a.village ?? a.municipality,
      };
    });
  }
}
