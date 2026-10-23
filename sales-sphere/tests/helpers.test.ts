import { describe, expect, it } from "vitest";
import { businessDaysBetween, nextLocalMorning } from "@/lib/pipeline/schedule";
import { applySpelling, checkVoiceRules } from "@/lib/voice";
import { decrypt, encrypt, sign, verify } from "@/lib/crypto";
import { followUpDue } from "@/lib/replies/followups";
import { quickClassify } from "@/lib/replies/sync";
import { parseRegionInput, complianceFor } from "@/lib/geo/regions";
import { planFieldVisits } from "@/lib/export/fieldVisit";
import { buildWorkbook } from "@/lib/export/excel";
import ExcelJS from "exceljs";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("schedule", () => {
  it("schedules for the prospect's next business-day morning", () => {
    // Friday 2026-10-23 15:00 UTC = 11:00 in Boston → next morning is Monday 08:30 EDT (12:30 UTC)
    expect(nextLocalMorning(new Date("2026-10-23T15:00:00Z"), "America/New_York").toISOString()).toBe("2026-10-26T12:30:00.000Z");
    // 03:00 UTC Tuesday = 07:00 Dubai → same day 08:30 Dubai (04:30 UTC)
    expect(nextLocalMorning(new Date("2026-10-20T03:00:00Z"), "Asia/Dubai").toISOString()).toBe("2026-10-20T04:30:00.000Z");
  });

  it("counts business days", () => {
    expect(businessDaysBetween(new Date("2026-10-23T10:00:00Z"), new Date("2026-10-29T10:00:00Z"))).toBe(4); // Fri → Thu
  });
});

describe("follow-ups", () => {
  const now = new Date("2026-10-29T10:00:00Z");
  const base = { now, businessDays: 4, maxFollowUps: 2, hasPending: false };
  it("is due after N business days, at most 2", () => {
    expect(followUpDue([{ kind: "initial", sentAt: new Date("2026-10-23T10:00:00Z") }], base)).toBe(1);
    expect(followUpDue([{ kind: "initial", sentAt: new Date("2026-10-26T10:00:00Z") }], base)).toBeNull();
    expect(followUpDue([{ kind: "initial", sentAt: new Date("2026-10-01T10:00:00Z") }, { kind: "followup1", sentAt: new Date("2026-10-08T10:00:00Z") }], base)).toBe(2);
    expect(followUpDue([{ kind: "initial", sentAt: new Date("2026-10-01T10:00:00Z") }, { kind: "followup1", sentAt: new Date("2026-10-08T10:00:00Z") }, { kind: "followup2", sentAt: new Date("2026-10-15T10:00:00Z") }], base)).toBeNull();
    expect(followUpDue([{ kind: "initial", sentAt: new Date("2026-10-01T10:00:00Z") }], { ...base, hasPending: true })).toBeNull();
  });
});

describe("voice rules", () => {
  it("flags buzzwords, exclamation marks and length", () => {
    const p = checkVoiceRules({ subject: "quick idea!", body: "We leverage synergy." }, { minWords: 80, maxWords: 130 });
    expect(p.join(" ")).toMatch(/words/);
    expect(p.join(" ")).toMatch(/exclamation/);
    expect(p.join(" ")).toMatch(/leverage/);
  });
  it("applies regional spelling", () => {
    expect(applySpelling("We optimize the organization", "en-GB")).toBe("We optimise the organisation");
    expect(applySpelling("Optimised programmes", "en-US")).toBe("Optimized programs");
  });
});

describe("crypto", () => {
  it("round-trips AES-256-GCM and rejects tampering", () => {
    const enc = encrypt("refresh-token", KEY);
    expect(decrypt(enc, KEY)).toBe("refresh-token");
    expect(() => decrypt(enc.slice(0, -2) + "AA", KEY)).toThrow();
  });
  it("signs and verifies OAuth state", () => {
    expect(verify<{ a: number }>(sign({ a: 1 }, 60, KEY), KEY).a).toBe(1);
    expect(() => verify(sign({ a: 1 }, -1, KEY), KEY)).toThrow(/expired/);
  });
});

describe("regions", () => {
  it("parses free-typed regions", () => {
    expect(parseRegionInput("within 30 km of Manchester")).toEqual([{ query: "Manchester", radiusKm: 30 }]);
    expect(parseRegionInput("Texas + Oklahoma")).toEqual([{ query: "Texas" }, { query: "Oklahoma" }]);
    expect(parseRegionInput("10 miles around Leeds")).toEqual([{ query: "Leeds", radiusKm: 16 }]);
  });
  it("sets compliance by country", () => {
    expect(complianceFor(["US"]).footer).toContain("{{physical_address}}");
    expect(complianceFor(["DE"]).footer).toMatch(/no thanks/);
    expect(complianceFor(["AE"]).footer).toBe("");
  });
});

describe("replies", () => {
  it("catches bounces and auto-replies without Claude", () => {
    expect(quickClassify({ from: "MAILER-DAEMON@x.com", subject: "Undeliverable", text: "" })).toBe("bounced");
    expect(quickClassify({ from: "a@b.com", subject: "Automatic reply: hello", text: "" })).toBe("out_of_office");
    expect(quickClassify({ from: "a@b.com", subject: "RE: hi", text: "Sounds good, Tuesday?" })).toBeNull();
  });
});

describe("exports", () => {
  it("groups field visits by area, hot first", () => {
    const s = (company: string, area: string, tier: string) => ({ company, area, tier, address: null, phone: null, hours: null, contact: null, mapUrl: null });
    const days = planFieldVisits([s("B", "Deira", "warm"), s("A", "Deira", "hot"), s("C", "Marina", "hot")], 1);
    expect(days.map((d) => `${d.area}:${d.stops[0]!.company}`)).toEqual(["Deira:A", "Deira:B", "Marina:C"]);
  });

  it("writes an xlsx with frozen header and tier colours", async () => {
    const buf = await buildWorkbook([
      { tier: "HOT", score: 90, company: "Acme", type: "", location: "", signal: "", pitch: "", contactName: "", title: "", email: "", emailStatus: "", linkedin: "", phone: "", address: "", source: "https://acme.com", draftStatus: "" },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.getRow(1).getCell(1).value).toBe("Tier");
    expect((ws.getRow(2).getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFF8CBAD");
  });
});
