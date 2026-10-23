"use client";

import { useState } from "react";

type Match = { label: string; kind: string; lat: number; lon: number; countryCode: string; state?: string; city?: string; query: string; radiusKm?: number };
type Part = { query: string; radiusKm?: number; matches: Match[] };

// Free-typed places → resolved locations via /api/geocode (Nominatim).
export function RegionBuilder() {
  const [text, setText] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);

  const resolve = async () => {
    setLoading(true);
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(text)}`);
    const data = (await res.json()) as { parts: Part[] };
    setParts(data.parts);
    setPicked(Object.fromEntries(data.parts.map((_, i) => [i, 0])));
    setLoading(false);
  };

  const chosen = parts.map((p, i) => p.matches[picked[i] ?? 0]).filter(Boolean);

  return (
    <>
      <label>Places <span className="muted">e.g. "Riyadh", "Germany", "within 30 km of Manchester", "Texas + Oklahoma"</span></label>
      <div className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Dubai, Abu Dhabi, Sharjah" />
        <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={resolve} disabled={!text || loading}>{loading ? "Looking up…" : "Look up"}</button></div>
      </div>
      {parts.map((p, i) => (
        <div key={i}>
          <label>{p.query}{p.radiusKm ? ` (within ${p.radiusKm} km)` : ""}</label>
          {p.matches.length === 0 ? <p className="err">No match found</p> : (
            <select value={picked[i] ?? 0} onChange={(e) => setPicked({ ...picked, [i]: Number(e.target.value) })}>
              {p.matches.map((m, j) => <option key={j} value={j}>{m.label} [{m.kind}]</option>)}
            </select>
          )}
        </div>
      ))}
      <input type="hidden" name="locations" value={JSON.stringify(chosen)} />
      {chosen.length > 0 && <p className="muted">Time zone, currency, spelling and compliance footer are filled in from the first place; you can edit them after saving.</p>}
    </>
  );
}
