import { prisma } from "./db";

export type StatRow = { key: string; label: string; drafts: number; sent: number; replies: number; meetings: number; credits: number };

export async function dashboardStats() {
  const [drafts, prospects, campaigns, mailboxes, regions, listTypes] = await Promise.all([
    prisma.draft.findMany({ select: { status: true, mailboxId: true, outlookCreatedAt: true, prospect: { select: { campaign: { select: { regionId: true, listTypeId: true } } } } } }),
    prisma.prospect.findMany({ select: { status: true, meetingBooked: true, campaign: { select: { regionId: true, listTypeId: true, mailboxId: true, region: { select: { defaultMailboxId: true } } } } } }),
    prisma.campaign.findMany({ select: { creditsUsed: true, regionId: true, listTypeId: true, mailboxId: true, region: { select: { defaultMailboxId: true } } } }),
    prisma.mailbox.findMany({ select: { id: true, email: true } }),
    prisma.region.findMany({ select: { id: true, name: true } }),
    prisma.listType.findMany({ select: { id: true, name: true } }),
  ]);
  const usd = await prisma.externalCall.aggregate({ _sum: { cost: true }, where: { costUnit: "usd" } });

  const isReply = (s: string) => s === "replied" || s === "not_interested";
  const empty = (key: string, label: string): StatRow => ({ key, label, drafts: 0, sent: 0, replies: 0, meetings: 0, credits: 0 });
  const group = (labels: { id: string; name: string }[]) => new Map(labels.map((l) => [l.id, empty(l.id, l.name)]));

  const byMailbox = group(mailboxes.map((m) => ({ id: m.id, name: m.email })));
  const byRegion = group(regions);
  const byList = group(listTypes);
  const total = empty("all", "All");

  for (const d of drafts) {
    const rows = [total, byMailbox.get(d.mailboxId), byRegion.get(d.prospect.campaign.regionId), byList.get(d.prospect.campaign.listTypeId)];
    for (const r of rows) {
      if (!r) continue;
      if (d.outlookCreatedAt || d.status !== "rejected") r.drafts++;
      if (d.status === "sent") r.sent++;
    }
  }
  for (const p of prospects) {
    const mb = p.campaign.mailboxId ?? p.campaign.region.defaultMailboxId;
    const rows = [total, mb ? byMailbox.get(mb) : undefined, byRegion.get(p.campaign.regionId), byList.get(p.campaign.listTypeId)];
    for (const r of rows) {
      if (!r) continue;
      if (isReply(p.status)) r.replies++;
      if (p.meetingBooked) r.meetings++;
    }
  }
  for (const c of campaigns) {
    const mb = c.mailboxId ?? c.region.defaultMailboxId;
    for (const r of [total, mb ? byMailbox.get(mb) : undefined, byRegion.get(c.regionId), byList.get(c.listTypeId)]) if (r) r.credits += c.creditsUsed;
  }
  return { total, byMailbox: [...byMailbox.values()], byRegion: [...byRegion.values()], byList: [...byList.values()], usdSpent: usd._sum.cost ?? 0 };
}
