import { prisma } from "../db";
import { dbCallLogger, type CallLogger } from "../audit";
import { Claude } from "../claude/client";
import { parseListTypeConfig } from "../listTypes/schema";
import { getSettings } from "../settings";
import { businessDaysBetween, nextLocalMorning } from "../pipeline/schedule";
import { loadWriterContext, writeCheckedFollowUp } from "../drafts/writer";
import { pushDraftToOutlook } from "../drafts/service";
import { isConnected } from "../graph/factory";

const KINDS = ["initial", "followup1", "followup2"] as const;

/** Decide whether a prospect is due a follow-up. Pure, for testing. */
export function followUpDue(
  sent: { kind: (typeof KINDS)[number]; sentAt: Date | null }[],
  opts: { now: Date; businessDays: number; maxFollowUps: number; hasPending: boolean },
): 1 | 2 | null {
  if (opts.hasPending) return null;
  const done = sent.filter((s) => s.sentAt).sort((a, b) => a.sentAt!.getTime() - b.sentAt!.getTime());
  const last = done[done.length - 1];
  if (!last) return null;
  const followUpsSent = done.filter((s) => s.kind !== "initial").length;
  if (followUpsSent >= Math.min(opts.maxFollowUps, 2)) return null;
  if (businessDaysBetween(last.sentAt!, opts.now) < opts.businessDays) return null;
  return (followUpsSent + 1) as 1 | 2;
}

export async function runFollowUps(logger: CallLogger = dbCallLogger, now = new Date()) {
  const settings = await getSettings();
  const prospects = await prisma.prospect.findMany({
    where: { status: { in: ["sent", "out_of_office"] } },
    include: { drafts: { orderBy: { createdAt: "asc" } }, company: true, contact: true, campaign: { include: { region: true, listType: true } } },
  });
  const claude = new Claude({ logger });
  const created: string[] = [];
  for (const p of prospects) {
    const n = followUpDue(
      p.drafts.filter((d) => d.status === "sent").map((d) => ({ kind: d.kind, sentAt: d.sentAt })),
      { now, businessDays: settings.followUpBusinessDays, maxFollowUps: settings.maxFollowUps, hasPending: p.drafts.some((d) => ["pending_review", "approved", "queued_to_send"].includes(d.status)) },
    );
    if (!n || !p.contact?.email) continue;
    const initial = p.drafts.find((d) => d.kind === "initial")!;
    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: initial.mailboxId } });
    const config = parseListTypeConfig(p.campaign.listType.config);
    const ctx = await loadWriterContext({ mailbox, region: p.campaign.region, config });
    const { body } = await writeCheckedFollowUp(claude, ctx, {
      number: n,
      company: { name: p.company.name },
      contact: { firstName: p.contact.firstName, name: p.contact.name },
      previous: p.drafts.filter((d) => d.status === "sent").map((d) => ({ subject: d.subject, body: d.body })),
      signal: p.signal ?? "",
      config,
    });
    const draft = await prisma.draft.create({
      data: {
        prospectId: p.id, mailboxId: mailbox.id, kind: KINDS[n], subject: `RE: ${initial.subject}`, body, originalBody: body, toEmail: p.contact.email,
        scheduledFor: nextLocalMorning(now, p.campaign.region.timeZone, settings.sendTimeLocal),
      },
    });
    if (isConnected(mailbox)) {
      await pushDraftToOutlook(draft.id, logger).catch(async (e) => {
        await prisma.campaignLog.create({ data: { campaignId: p.campaignId, level: "warn", message: `${p.company.name}: follow-up ${n} draft not pushed: ${(e as Error).message}` } });
      });
    }
    created.push(`${p.company.name} (follow-up ${n})`);
  }
  return created;
}
