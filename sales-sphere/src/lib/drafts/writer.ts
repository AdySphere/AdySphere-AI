import { prisma } from "../db";
import type { Claude } from "../claude/client";
import { writeEmail, writeFollowUp, type WriterContext } from "../claude/prompts";
import type { ListTypeConfig } from "../listTypes/schema";
import { getSettings } from "../settings";
import { applySpelling, checkVoiceRules } from "../voice";

export async function loadWriterContext(p: { mailbox: { personaName: string; personaTone: string }; region: { spelling: string; currency: string }; config: ListTypeConfig }): Promise<WriterContext> {
  const settings = await getSettings();
  const proof = await prisma.proofPoint.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  const wanted = p.config.proofPointLabels.map((l) => l.toLowerCase());
  const proofPoints = wanted.length ? proof.filter((x) => wanted.includes(x.label.toLowerCase())) : proof;
  const seeds = await prisma.voiceExample.findMany({ where: { kind: "seed" }, orderBy: { createdAt: "asc" }, take: 10 });
  const edits = await prisma.voiceExample.findMany({ where: { kind: "edit" }, orderBy: { createdAt: "desc" }, take: 6 });
  return {
    voiceGuide: settings.voiceGuide,
    proofPoints,
    examples: [...seeds, ...edits.reverse()],
    personaName: p.mailbox.personaName,
    personaTone: p.mailbox.personaTone,
    spelling: p.region.spelling,
    currency: p.region.currency,
  };
}

type WriteArgs = Omit<Parameters<typeof writeEmail>[2], "feedback">;

/** Writes an email and re-asks (up to twice) if it breaks the hard voice rules. */
export async function writeCheckedEmail(claude: Claude, ctx: WriterContext, args: WriteArgs) {
  let feedback: string[] = [];
  let email = { subject: "", body: "" };
  for (let attempt = 0; attempt < 3; attempt++) {
    email = await writeEmail(claude, ctx, { ...args, feedback });
    email = { subject: applySpelling(email.subject, ctx.spelling), body: applySpelling(email.body, ctx.spelling) };
    feedback = checkVoiceRules(email, { minWords: 70, maxWords: 140 });
    if (feedback.length === 0) break;
  }
  return { ...email, problems: feedback };
}

export async function writeCheckedFollowUp(claude: Claude, ctx: WriterContext, args: Omit<Parameters<typeof writeFollowUp>[2], "feedback">) {
  let feedback: string[] = [];
  let body = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    body = applySpelling(await writeFollowUp(claude, ctx, { ...args, feedback }), ctx.spelling);
    feedback = checkVoiceRules({ subject: "", body }, { minWords: 15, maxWords: 75 });
    if (feedback.length === 0) break;
  }
  return { body, problems: feedback };
}
