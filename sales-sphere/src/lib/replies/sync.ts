import type { Mailbox } from "@prisma/client";
import { prisma } from "../db";
import { dbCallLogger, type CallLogger } from "../audit";
import { env } from "../env";
import { Claude } from "../claude/client";
import { classifyReply } from "../claude/prompts";
import type { GraphClient, GraphMessage } from "../graph/client";
import { GraphError } from "../graph/client";
import { graphFor, isConnected } from "../graph/factory";
import { htmlToText } from "../search/fetchPage";
import { normalizeDomain } from "../domain";

const BOUNCE_SENDER = /mailer-daemon|postmaster|microsoftexchange|mail delivery/i;
const OOO_SUBJECT = /automatic reply|auto(matic)?[- ]?reply|out of (the )?office|abwesenheit|absence/i;

export type ReplyOutcome = "replied" | "out_of_office" | "bounced" | "not_interested";

/** Cheap rules first; Claude only when a human seems to have written. */
export function quickClassify(m: { from: string; subject: string; text: string }): ReplyOutcome | null {
  if (BOUNCE_SENDER.test(m.from) || /undeliverable|delivery (status notification|has failed)|returned mail/i.test(m.subject)) return "bounced";
  if (OOO_SUBJECT.test(m.subject)) return "out_of_office";
  if (/^\s*(unsubscribe|remove me|stop)\s*\.?\s*$/i.test(m.text.split("\n")[0] ?? "")) return "not_interested";
  return null;
}

/** Mark drafts that were sent from Outlook (or by us) and record their Sent Items id. */
async function syncSentStatus(mailbox: Mailbox, graph: GraphClient) {
  const drafts = await prisma.draft.findMany({
    where: { mailboxId: mailbox.id, conversationId: { not: null }, sentMessageId: null, status: { in: ["pending_review", "approved", "queued_to_send", "sent"] } },
  });
  for (const d of drafts) {
    let msgs: GraphMessage[];
    try {
      msgs = await graph.listConversation(d.conversationId!);
    } catch {
      continue;
    }
    const mine = msgs
      .filter((m) => !m.isDraft && m.from?.emailAddress.address.toLowerCase() === mailbox.email.toLowerCase() && m.sentDateTime)
      .filter((m) => !d.outlookCreatedAt || new Date(m.sentDateTime!) >= d.outlookCreatedAt)
      .sort((a, b) => a.sentDateTime!.localeCompare(b.sentDateTime!));
    const claimed = new Set((await prisma.draft.findMany({ where: { conversationId: d.conversationId, sentMessageId: { not: null } }, select: { sentMessageId: true } })).map((x) => x.sentMessageId));
    const sent = mine.find((m) => !claimed.has(m.id));
    if (sent) {
      await prisma.draft.update({ where: { id: d.id }, data: { status: "sent", sentMessageId: sent.id, sentAt: new Date(sent.sentDateTime!) } });
      await prisma.prospect.updateMany({ where: { id: d.prospectId, status: { in: ["drafted", "approved"] } }, data: { status: "sent" } });
      continue;
    }
    // Draft deleted in Outlook without sending
    if (d.graphMessageId && d.status !== "sent") {
      try {
        await graph.getMessage(d.graphMessageId);
      } catch (e) {
        if (e instanceof GraphError && e.status === 404) await prisma.draft.update({ where: { id: d.id }, data: { graphMessageId: null, conversationId: null, outlookCreatedAt: null } });
      }
    }
  }
}

export async function syncMailboxReplies(mailbox: Mailbox, logger: CallLogger = dbCallLogger) {
  const graph = graphFor(mailbox, logger);
  await syncSentStatus(mailbox, graph);
  const claude = env.hasAnthropic() ? new Claude({ logger }) : null;
  const sentDrafts = await prisma.draft.findMany({
    where: { mailboxId: mailbox.id, status: "sent", conversationId: { not: null } },
    include: { prospect: { include: { company: true, contact: true } } },
  });
  const byConversation = new Map<string, (typeof sentDrafts)[number]>();
  for (const d of sentDrafts) byConversation.set(d.conversationId!, d);
  const results: { company: string; outcome: ReplyOutcome; summary: string }[] = [];
  const handled = new Set<string>();

  const record = async (d: (typeof sentDrafts)[number], outcome: ReplyOutcome, summary: string, meeting = false) => {
    if (handled.has(d.prospectId)) return;
    handled.add(d.prospectId);
    const p = d.prospect;
    // Don't downgrade a human reply to an out-of-office
    if (p.status === "replied" && outcome === "out_of_office") return;
    await prisma.prospect.update({ where: { id: p.id }, data: { status: outcome, replySummary: summary, ...(meeting ? { meetingBooked: true } : {}) } });
    if (outcome === "not_interested" || outcome === "bounced") {
      const value = outcome === "bounced" ? normalizeDomain(d.toEmail) : normalizeDomain(p.company.domain);
      if (outcome === "bounced" && p.contact) await prisma.contact.update({ where: { id: p.contact.id }, data: { emailStatus: "bounced" } });
      if (value && outcome === "not_interested") {
        await prisma.exclusion.upsert({ where: { kind_value: { kind: "domain", value } }, create: { kind: "domain", value, reason: "not_interested", note: summary.slice(0, 200) }, update: {} });
      }
    }
    // Stop pending follow-ups for this prospect
    await prisma.draft.updateMany({ where: { prospectId: p.id, kind: { not: "initial" }, status: "pending_review" }, data: { status: "rejected" } });
    results.push({ company: p.company.name, outcome, summary });
  };

  for (const [conversationId, d] of byConversation) {
    if (["replied", "not_interested", "bounced"].includes(d.prospect.status)) continue;
    let msgs: GraphMessage[];
    try {
      msgs = await graph.listConversation(conversationId);
    } catch {
      continue;
    }
    const incoming = msgs
      .filter((m) => !m.isDraft && m.receivedDateTime && m.from && m.from.emailAddress.address.toLowerCase() !== mailbox.email.toLowerCase())
      .filter((m) => !d.sentAt || new Date(m.receivedDateTime!) > d.sentAt)
      .sort((a, b) => b.receivedDateTime!.localeCompare(a.receivedDateTime!));
    const latest = incoming[0];
    if (!latest) continue;
    const text = htmlToText(latest.body?.content ?? latest.bodyPreview ?? "");
    const input = { from: latest.from!.emailAddress.address, subject: latest.subject, text };
    const quick = quickClassify(input);
    if (quick && quick !== "replied") {
      await record(d, quick, quick === "out_of_office" ? "Out of office auto-reply." : quick === "bounced" ? "Delivery failed." : "Asked not to be contacted.");
    } else if (claude) {
      const c = await classifyReply(claude, input);
      await record(d, c.status, c.summary, c.meeting_requested);
    } else {
      await record(d, "replied", (latest.bodyPreview ?? "").slice(0, 140));
    }
  }

  // Bounces often arrive outside the thread
  const since = mailbox.lastReplySyncAt ?? new Date(Date.now() - 7 * 86400000);
  try {
    const inbox = await graph.listInboxSince(since);
    for (const m of inbox) {
      if (!m.from || !BOUNCE_SENDER.test(`${m.from.emailAddress.address} ${m.from.emailAddress.name ?? ""}`)) continue;
      const text = htmlToText(m.body?.content ?? m.bodyPreview ?? "").toLowerCase();
      const d = sentDrafts.find((x) => text.includes(x.toEmail.toLowerCase()));
      if (d) await record(d, "bounced", "Delivery failed (bounce notice).");
    }
  } catch {
    /* inbox scan is best effort */
  }
  await prisma.mailbox.update({ where: { id: mailbox.id }, data: { lastReplySyncAt: new Date() } });
  return results;
}

export async function syncAllReplies(logger: CallLogger = dbCallLogger) {
  const mailboxes = (await prisma.mailbox.findMany()).filter(isConnected);
  const out: Record<string, Awaited<ReturnType<typeof syncMailboxReplies>> | { error: string }> = {};
  for (const m of mailboxes) {
    try {
      out[m.email] = await syncMailboxReplies(m, logger);
    } catch (e) {
      out[m.email] = { error: (e as Error).message };
    }
  }
  return out;
}
