import type { FetchLike } from "@/lib/audit";

export type Recorded = { url: string; method: string; body: unknown; headers: Record<string, string> };

/** A fetch mock that records calls and answers from a handler. */
export function mockFetch(handler: (req: Recorded) => { status?: number; json?: unknown; text?: string }): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetch: FetchLike = async (url, init) => {
    const req: Recorded = {
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
    };
    calls.push(req);
    const r = handler(req);
    const status = r.status ?? 200;
    return new Response(r.json !== undefined ? JSON.stringify(r.json) : (r.text ?? null), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}
