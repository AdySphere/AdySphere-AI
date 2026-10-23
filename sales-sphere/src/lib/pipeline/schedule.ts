// Time-zone and business-day helpers (no external deps; uses Intl).

function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off1 = tzOffsetMinutes(guess, timeZone);
  const first = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(first, timeZone);
  return off1 === off2 ? first : new Date(guess.getTime() - off2 * 60000);
}

export function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hh: Number(get("hour")), mm: Number(get("minute")), weekday };
}

const isWeekend = (weekday: number) => weekday === 0 || weekday === 6;

// Next business-day morning (e.g. 08:30) in the prospect's time zone, strictly after `now`.
export function nextLocalMorning(now: Date, timeZone: string, hhmm = "08:30"): Date {
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  for (let i = 0; i < 10; i++) {
    const day = localParts(new Date(now.getTime() + i * 86400000), timeZone);
    const candidate = zonedToUtc(day.y, day.m, day.d, hh, mm, timeZone);
    if (candidate.getTime() > now.getTime() && !isWeekend(localParts(candidate, timeZone).weekday)) return candidate;
  }
  throw new Error("Could not find a business-day morning");
}

export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (!isWeekend(cur.getUTCDay())) count++;
  }
  return count;
}

export function startOfUtcDay(at = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}
