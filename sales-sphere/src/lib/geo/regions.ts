import tzLookup from "@photostructure/tz-lookup";
import countryToCurrency from "country-to-currency";

export type RegionLocation = {
  label: string; // "Manchester, England, United Kingdom"
  query: string; // what was typed
  kind: "country" | "state" | "city" | "radius" | "place";
  lat: number;
  lon: number;
  countryCode: string; // ISO-3166 alpha-2, upper case
  state?: string;
  city?: string;
  radiusKm?: number;
};

export type ParsedRegionPart = { query: string; radiusKm?: number };

// "within 30 km of Manchester" | "Texas + Oklahoma" | "Riyadh, Jeddah" | "Germany"
export function parseRegionInput(input: string): ParsedRegionPart[] {
  return input
    .split(/\s*(?:\+|;|,(?![^()]*\))|\band\b|\n)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(?:within\s+)?(\d+(?:\.\d+)?)\s*(km|kms|kilometres|kilometers|mi|miles?)\s+(?:of|from|around)\s+(.+)$/i);
      if (!m) return { query: part };
      const n = Number(m[1]);
      const km = /^mi/i.test(m[2]!) ? Math.round(n * 1.609344) : n;
      return { query: m[3]!.trim(), radiusKm: km };
    });
}

const EU_EEA = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO","CH"]);
const US_SPELLING = new Set(["US", "PH", "PR"]);

export function regionDefaults(locations: RegionLocation[]) {
  const first = locations[0];
  const countries = [...new Set(locations.map((l) => l.countryCode))];
  const cc = first?.countryCode ?? "US";
  const timeZone = first ? tzLookup(first.lat, first.lon) : "UTC";
  const currency = (countryToCurrency as Record<string, string>)[cc] ?? "USD";
  const spelling = US_SPELLING.has(cc) ? "en-US" : "en-GB";
  const { note, footer } = complianceFor(countries);
  return { timeZone, currency, spelling, complianceNote: note, complianceFooter: footer };
}

export function complianceFor(countries: string[]): { note: string; footer: string } {
  if (countries.includes("US")) {
    return {
      note: "US (CAN-SPAM): honest subject, physical postal address and a clear opt-out in every email.",
      footer: "AdySphere Co · {{physical_address}}\nIf you'd rather not hear from me, reply \"unsubscribe\" and I won't email again.",
    };
  }
  if (countries.includes("GB") || countries.some((c) => EU_EEA.has(c))) {
    return {
      note: "UK/EU (PECR/GDPR, legitimate interest for B2B): include an opt-out line and only contact business addresses.",
      footer: "If this isn't relevant, just reply \"no thanks\" and I won't contact you again.",
    };
  }
  if (countries.includes("CA")) {
    return {
      note: "Canada (CASL): identify the sender, include contact details and an unsubscribe option.",
      footer: "AdySphere Co · {{physical_address}}\nReply \"unsubscribe\" and I won't email again.",
    };
  }
  return { note: "", footer: "" };
}

export function locationSearchLabel(l: RegionLocation): string {
  if (l.radiusKm) return `within ${l.radiusKm} km of ${l.city ?? l.label.split(",")[0]}`;
  return l.label.split(",").slice(0, 2).join(",").trim();
}
