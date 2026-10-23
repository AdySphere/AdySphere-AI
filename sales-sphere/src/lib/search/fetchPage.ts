import robotsParser from "robots-parser";
import type { CallLogger, FetchLike } from "../audit";
import { isLinkedInUrl } from "../domain";

const UA = "SalesSphereBot/0.1 (+https://adysphere.com; research for B2B outreach)";
const robotsCache = new Map<string, ReturnType<typeof robotsParser> | null>();

/**
 * Fetches a company page for scoring context. Respects robots.txt, never touches LinkedIn,
 * and returns only a short plain-text extract.
 */
export async function fetchPageText(url: string, logger: CallLogger, f: FetchLike = fetch, maxChars = 3000): Promise<string | null> {
  if (isLinkedInUrl(url)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!(await allowedByRobots(u, f))) return null;
  try {
    const res = await f(u.toString(), { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(10000), redirect: "follow" });
    await logger.log({ provider: "web", operation: "fetch_page", costUnit: "none", status: res.ok ? "ok" : "error", meta: { host: u.host } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    return htmlToText(await res.text()).slice(0, maxChars);
  } catch {
    return null;
  }
}

async function allowedByRobots(u: URL, f: FetchLike): Promise<boolean> {
  const origin = u.origin;
  if (!robotsCache.has(origin)) {
    try {
      const res = await f(`${origin}/robots.txt`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000) });
      robotsCache.set(origin, res.ok ? robotsParser(`${origin}/robots.txt`, await res.text()) : null);
    } catch {
      robotsCache.set(origin, null);
    }
  }
  const robots = robotsCache.get(origin);
  return robots ? robots.isAllowed(u.toString(), "SalesSphereBot") !== false : true;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
