import type { GraphClient } from "../graph/client";
import { composeEmailHtml, footerIsComplete, renderFooter } from "./compose";

export class DailyCapError extends Error {
  constructor(public mailbox: string, public limit: number) {
    super(`Daily draft limit reached for ${mailbox} (${limit})`);
  }
}

export class FooterIncompleteError extends Error {
  constructor() {
    super("This region's compliance footer needs a physical address. Set it in Settings → General.");
  }
}

export type DraftInput = {
  kind: "initial" | "followup1" | "followup2";
  subject: string;
  body: string;
  toEmail: string;
  toName?: string;
  scheduledFor?: Date | null;
  replyToMessageId?: string | null; // for follow-ups: the sent message to reply to
};

export type MailboxInput = {
  email: string;
  personaName: string;
  signOff: string;
  signatureHtml: string;
  dailyDraftLimit: number;
};

/**
 * Creates the Outlook draft, enforcing the mailbox's hard daily cap.
 * `draftsCreatedToday` must count drafts already pushed to this mailbox today.
 */
export async function createOutlookDraft(p: {
  graph: GraphClient;
  mailbox: MailboxInput;
  draft: DraftInput;
  footerTemplate: string;
  physicalAddress: string;
  draftsCreatedToday: number;
}): Promise<{ id: string; conversationId: string; html: string }> {
  if (p.draftsCreatedToday >= p.mailbox.dailyDraftLimit) throw new DailyCapError(p.mailbox.email, p.mailbox.dailyDraftLimit);
  if (!footerIsComplete(p.footerTemplate, { physicalAddress: p.physicalAddress })) throw new FooterIncompleteError();

  const html = composeEmailHtml({
    body: p.draft.body,
    signOff: p.mailbox.signOff,
    personaName: p.mailbox.personaName,
    signatureHtml: p.mailbox.signatureHtml,
    // Follow-ups sit in the same thread; keep the footer so every message carries the opt-out.
    footer: renderFooter(p.footerTemplate, { physicalAddress: p.physicalAddress }),
  });

  const msg = p.draft.replyToMessageId
    ? await p.graph.createReplyDraft(p.draft.replyToMessageId, { html, deferredSendAt: p.draft.scheduledFor })
    : await p.graph.createDraft({
        subject: p.draft.subject,
        html,
        to: { email: p.draft.toEmail, name: p.draft.toName },
        deferredSendAt: p.draft.scheduledFor,
      });
  return { id: msg.id, conversationId: msg.conversationId, html };
}
