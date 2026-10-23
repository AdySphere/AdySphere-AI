import { prisma } from "../db";
import type { CallLogger } from "../audit";
import { dbCallLogger } from "../audit";
import { graphFor, isConnected } from "../graph/factory";
import { getSettings } from "../settings";
import { startOfUtcDay } from "../pipeline/schedule";
import { composeEmailHtml, renderFooter } from "./compose";
import { createOutlookDraft, DailyCapError } from "./outlook";
import { Claude } from "../claude/client";
import { loadWriterContext, writeCheckedEmail } from "./writer";
import { parseListTypeConfig } from "../listTypes/schema";
import { normalizeDomain } from "../domain";
import type { Evidence } from "../pipeline/types";

async function loadDraft(id: string) {
  return prisma.draft.findUniqueOrThrow({
    where: { id },
    include: { mailbox: true, prospect: { include: { company: true, contact: true, campaign: { include: { region: true, listType: true } } } } },
  });
}

export async function draftsCreatedToday(mailboxId: string) {
  return prisma.draft.count({ where: { mailboxId, outlookCreatedAt: { gte: startOfUtcDay() } } });
}

/** Creates the Outlook draft for a stored draft (or updates it if it already exists). */
export async function pushDraftToOutlook(draftId: string, logger: CallLogger = dbCallLogger) {
  const d = await loadDraft(draftId);
  if (!isConnected(d.mailbox)) throw new Error(`Mailbox ${d.mailbox.email} is not connected`);
  const settings = await getSettings();
  const graph = graphFor(d.mailbox, logger);
  const region = d.prospect.campaign.region;

  if (d.graphMessageId) {
    const html = composeEmailHtml({
      body: d.body,
      signOff: d.mailbox.signOff,
      personaName: d.mailbox.personaName,
      signatureHtml: d.mailbox.signatureHtml,
      footer: renderFooter(region.complianceFooter, { physicalAddress: settings.physicalAddress }),
    });
    await graph.updateDraft(d.graphMessageId, { subject: d.kind === "initial" ? d.subject : undefined, html });
    return;
  }

  let replyTo: string | null = null;
  if (d.kind !== "initial") {
    const prev = await prisma.draft.findFirst({ where: { prospectId: d.prospectId, status: "sent", sentMessageId: { not: null } }, orderBy: { sentAt: "desc" } });
    replyTo = prev?.sentMessageId ?? null;
    if (!replyTo) throw new Error("Cannot create follow-up: the previous email has not been seen in Sent Items yet");
  }

  const created = await createOutlookDraft({
    graph,
    mailbox: d.mailbox,
    draft: { kind: d.kind, subject: d.subject, body: d.body, toEmail: d.toEmail, toName: d.prospect.contact?.name, scheduledFor: d.scheduledFor, replyToMessageId: replyTo },
    footerTemplate: region.complianceFooter,
    physicalAddress: settings.physicalAddress,
    draftsCreatedToday: await draftsCreatedToday(d.mailboxId),
  });
  await prisma.draft.update({ where: { id: d.id }, data: { graphMessageId: created.id, conversationId: created.conversationId, outlookCreatedAt: new Date() } });
}

/** Push every not-yet-pushed draft for a mailbox, stopping at the daily cap. */
export async function pushPendingDrafts(mailboxId: string, logger: CallLogger = dbCallLogger) {
  const pending = await prisma.draft.findMany({ where: { mailboxId, graphMessageId: null, status: { in: ["pending_review", "approved"] } }, orderBy: { createdAt: "asc" } });
  let pushed = 0;
  for (const d of pending) {
    try {
      await pushDraftToOutlook(d.id, logger);
      pushed++;
    } catch (e) {
      if (e instanceof DailyCapError) return { pushed, stoppedAtCap: true };
      throw e;
    }
  }
  return { pushed, stoppedAtCap: false };
}

export async function updateDraftContent(draftId: string, p: { subject: string; body: string }) {
  await prisma.draft.update({ where: { id: draftId }, data: { subject: p.subject, body: p.body } });
  const d = await loadDraft(draftId);
  if (d.graphMessageId && isConnected(d.mailbox)) await pushDraftToOutlook(draftId);
}

export async function approveDraft(draftId: string, edited?: { subject: string; body: string }) {
  if (edited) await updateDraftContent(draftId, edited);
  const d = await loadDraft(draftId);
  // Learn from Adyasha's edits: store before/after pairs as few-shot examples.
  if (d.body.trim() !== d.originalBody.trim()) {
    await prisma.voiceExample.create({ data: { kind: "edit", subject: d.subject, before: d.originalBody, after: d.body } });
  }
  await prisma.draft.update({ where: { id: draftId }, data: { status: "approved" } });
  if (d.kind === "initial") await prisma.prospect.update({ where: { id: d.prospectId }, data: { status: "approved" } });
}

export async function rejectDraft(draftId: string) {
  const d = await loadDraft(draftId);
  if (d.graphMessageId && isConnected(d.mailbox)) {
    await graphFor(d.mailbox, dbCallLogger).deleteMessage(d.graphMessageId).catch(() => undefined);
  }
  await prisma.draft.update({ where: { id: draftId }, data: { status: "rejected" } });
  await prisma.prospect.update({ where: { id: d.prospectId }, data: { status: "rejected" } });
  const domain = normalizeDomain(d.prospect.company.domain);
  if (domain) {
    await prisma.exclusion.upsert({
      where: { kind_value: { kind: "domain", value: domain } },
      create: { kind: "domain", value: domain, reason: "rejected", note: `Rejected in review (${d.prospect.company.name})` },
      update: {},
    });
  }
}

export async function regenerateDraft(draftId: string, note: string) {
  const d = await loadDraft(draftId);
  if (d.kind !== "initial") throw new Error("Regenerate is available for first emails; edit follow-ups directly");
  const p = d.prospect;
  const config = parseListTypeConfig(p.campaign.listType.config);
  const claude = new Claude({ logger: dbCallLogger, campaignId: p.campaignId });
  const ctx = await loadWriterContext({ mailbox: d.mailbox, region: p.campaign.region, config });
  const email = await writeCheckedEmail(claude, ctx, {
    listName: p.campaign.listType.name,
    config,
    company: { name: p.company.name, domain: p.company.domain, location: p.company.location },
    contact: { firstName: p.contact?.firstName, name: p.contact?.name ?? "there", title: p.contact?.title },
    whyNow: p.whyNow ?? "",
    signal: p.signal ?? "",
    pitch: p.pitch ?? "",
    evidence: (p.evidence as Evidence[]) ?? [],
    note,
  });
  await prisma.draft.update({ where: { id: draftId }, data: { subject: email.subject, body: email.body, originalBody: email.body, regenerateNote: note } });
  if (d.graphMessageId && isConnected(d.mailbox)) await pushDraftToOutlook(draftId);
  return email;
}

/**
 * Sends a batch the user approved in the UI. Refuses unless the mailbox has "allow send" on.
 * Drafts carry a deferred-send time, so Exchange delivers them in the prospect's morning.
 */
export async function sendApprovedBatch(mailboxId: string, draftIds: string[]) {
  const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
  if (!mailbox.allowSend) throw new Error(`Sending is switched off for ${mailbox.email}`);
  const graph = graphFor(mailbox, dbCallLogger);
  const drafts = await prisma.draft.findMany({ where: { id: { in: draftIds }, mailboxId, status: "approved" } });
  let sent = 0;
  for (const d of drafts) {
    if (!d.graphMessageId) await pushDraftToOutlook(d.id);
    const fresh = await prisma.draft.findUniqueOrThrow({ where: { id: d.id } });
    await prisma.draft.update({ where: { id: d.id }, data: { status: "queued_to_send" } });
    try {
      await graph.sendDraft(fresh.graphMessageId!);
      await prisma.draft.update({ where: { id: d.id }, data: { status: "sent", sentAt: fresh.scheduledFor && fresh.scheduledFor > new Date() ? fresh.scheduledFor : new Date() } });
      await prisma.prospect.update({ where: { id: d.prospectId }, data: { status: "sent" } });
      sent++;
    } catch (e) {
      await prisma.draft.update({ where: { id: d.id }, data: { status: "failed" } });
      throw e;
    }
  }
  return { sent };
}
