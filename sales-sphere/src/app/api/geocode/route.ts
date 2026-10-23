import { NextResponse, type NextRequest } from "next/server";
import { Nominatim } from "@/lib/geo/nominatim";
import { parseRegionInput } from "@/lib/geo/regions";
import { env } from "@/lib/env";
import { dbCallLogger } from "@/lib/audit";

// Resolves free-typed places: "within 30 km of Manchester", "Texas + Oklahoma", "Riyadh".
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const geo = new Nominatim({ baseUrl: env.nominatimBaseUrl(), contactEmail: env.nominatimContact(), logger: dbCallLogger });
  const parts = parseRegionInput(q).slice(0, 8);
  const out = [];
  for (const part of parts) {
    const matches = await geo.search(part.query, 5).catch(() => []);
    out.push({ ...part, matches: matches.map((m) => ({ ...m, query: part.query, radiusKm: part.radiusKm, kind: part.radiusKm ? "radius" : m.kind })) });
  }
  return NextResponse.json({ parts: out });
}
