export type VisitStop = { company: string; area: string; address: string | null; phone: string | null; hours: string | null; tier: string | null; contact: string | null; mapUrl: string | null };
export type VisitDay = { day: number; area: string; stops: VisitStop[] };

/**
 * Route sheet: group by area, hot first within an area, then split into days of `perDay` stops.
 * Areas are kept together so a day stays in one part of town where possible.
 */
export function planFieldVisits(stops: VisitStop[], perDay: number): VisitDay[] {
  const tierRank = (t: string | null) => (t === "hot" ? 0 : t === "warm" ? 1 : 2);
  const byArea = new Map<string, VisitStop[]>();
  for (const s of stops) {
    const key = s.area || "Unknown area";
    byArea.set(key, [...(byArea.get(key) ?? []), s]);
  }
  const areas = [...byArea.entries()]
    .map(([area, list]) => ({ area, list: list.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.company.localeCompare(b.company)) }))
    .sort((a, b) => b.list.length - a.list.length || a.area.localeCompare(b.area));
  const days: VisitDay[] = [];
  for (const { area, list } of areas) {
    for (let i = 0; i < list.length; i += perDay) days.push({ day: days.length + 1, area, stops: list.slice(i, i + perDay) });
  }
  return days;
}

export function mapsLink(address: string | null, company: string): string | null {
  const q = address ?? company;
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}
