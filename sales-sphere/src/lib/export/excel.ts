import ExcelJS from "exceljs";
import { prisma } from "../db";
import type { Evidence } from "../pipeline/types";

export const EXPORT_COLUMNS = [
  { header: "Tier", key: "tier", width: 8 },
  { header: "Score", key: "score", width: 7 },
  { header: "Company", key: "company", width: 28 },
  { header: "Type", key: "type", width: 22 },
  { header: "Location", key: "location", width: 22 },
  { header: "Signal", key: "signal", width: 40 },
  { header: "Pitch", key: "pitch", width: 40 },
  { header: "Contact name", key: "contactName", width: 22 },
  { header: "Title", key: "title", width: 24 },
  { header: "Email", key: "email", width: 30 },
  { header: "Email status", key: "emailStatus", width: 14 },
  { header: "LinkedIn", key: "linkedin", width: 30 },
  { header: "Company phone", key: "phone", width: 16 },
  { header: "Address", key: "address", width: 32 },
  { header: "Source URL", key: "source", width: 40 },
  { header: "Draft status", key: "draftStatus", width: 16 },
] as const;

const FILL = { hot: "FFF8CBAD", warm: "FFFFF2CC" } as const;

export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number]["key"], string | number | null>;

export async function campaignRows(campaignId: string): Promise<ExportRow[]> {
  const prospects = await prisma.prospect.findMany({
    where: { campaignId },
    include: { company: true, contact: true, drafts: { orderBy: { createdAt: "desc" } }, campaign: { include: { listType: true } } },
    orderBy: [{ score: "desc" }],
  });
  return prospects.map((p) => {
    const draft = p.drafts.find((d) => d.kind === "initial");
    const status = p.status === "linkedin_phone_only" ? "LinkedIn/phone only" : draft ? `${draft.status}${draft.graphMessageId ? " (in Outlook)" : ""}` : p.status;
    return {
      tier: p.tier ? p.tier.toUpperCase() : "",
      score: p.score,
      company: p.company.name,
      type: p.company.industry ?? p.campaign.listType.name,
      location: p.company.location,
      signal: p.signal,
      pitch: p.pitch,
      contactName: p.contact?.name ?? null,
      title: p.contact?.title ?? null,
      email: p.contact?.email ?? null,
      emailStatus: p.contact?.emailStatus ?? null,
      linkedin: p.contact?.linkedinUrl ?? null,
      phone: p.company.phone,
      address: p.company.address,
      source: ((p.evidence as Evidence[]) ?? [])[0]?.url ?? null,
      draftStatus: status,
    };
  });
}

export async function buildWorkbook(rows: ExportRow[], sheetName = "Prospects"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sales Sphere";
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = EXPORT_COLUMNS.map((c) => ({ ...c }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  for (const r of rows) {
    const row = ws.addRow(r);
    const tier = String(r.tier ?? "").toLowerCase();
    if (tier === "hot" || tier === "warm") row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[tier] } };
    if (r.source) row.getCell("source").value = { text: String(r.source), hyperlink: String(r.source) };
  }
  ws.autoFilter = { from: "A1", to: { row: 1, column: EXPORT_COLUMNS.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
