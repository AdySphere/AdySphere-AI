"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dbCallLogger } from "@/lib/audit";
import { confirmCampaign, runCampaign, skipEnrichment } from "@/lib/pipeline/run";
import { approveDraft, pushPendingDrafts, regenerateDraft, rejectDraft, sendApprovedBatch, updateDraftContent } from "@/lib/drafts/service";
import { syncAllReplies } from "@/lib/replies/sync";
import { runFollowUps } from "@/lib/replies/followups";
import { updateSettings, type AppSettings } from "@/lib/settings";
import { ListTypeConfigSchema, slugify } from "@/lib/listTypes/schema";
import { Claude } from "@/lib/claude/client";
import { draftListTypeConfig } from "@/lib/claude/prompts";
import { regionDefaults, type RegionLocation } from "@/lib/geo/regions";
import { toExclusionEntry } from "@/lib/pipeline/exclusions";
import { sanitizeSignature } from "@/lib/drafts/compose";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const lines = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

// ---------- Campaigns ----------

export async function createCampaign(f: FormData) {
  const listType = await prisma.listType.findUniqueOrThrow({ where: { id: str(f, "listTypeId") } });
  if (listType.status === "paused") throw new Error("That list type is paused");
  const c = await prisma.campaign.create({
    data: {
      regionId: str(f, "regionId"),
      listTypeId: listType.id,
      targetCount: Math.max(1, Math.min(500, Number(str(f, "targetCount")) || 25)),
      verticalText: str(f, "verticalText") || null,
      mailboxId: str(f, "mailboxId") || null,
    },
  });
  after(() => runCampaign(c.id));
  redirect(`/campaigns/${c.id}`);
}

export async function confirmStage(campaignId: string, stage: "run" | "enrich") {
  await confirmCampaign(campaignId, stage);
  after(() => runCampaign(campaignId));
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function skipEnrich(campaignId: string) {
  await skipEnrichment(campaignId);
  after(() => runCampaign(campaignId));
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function resumeCampaign(campaignId: string) {
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (c.status === "failed") {
    // Resume from the last stage that has data.
    const drafts = await prisma.draft.count({ where: { prospect: { campaignId } } });
    const contacts = await prisma.contact.count({ where: { prospect: { campaignId } } });
    const status = drafts > 0 || contacts > 0 ? "writing" : "discovering";
    await prisma.campaign.update({ where: { id: campaignId }, data: { status, error: null } });
  }
  after(() => runCampaign(campaignId));
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function cancelCampaign(campaignId: string) {
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "cancelled" } });
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function toggleMeeting(prospectId: string) {
  const p = await prisma.prospect.findUniqueOrThrow({ where: { id: prospectId } });
  await prisma.prospect.update({ where: { id: prospectId }, data: { meetingBooked: !p.meetingBooked } });
  revalidatePath(`/campaigns/${p.campaignId}`);
}

// ---------- Review queue ----------

export async function saveDraft(draftId: string, f: FormData) {
  await updateDraftContent(draftId, { subject: str(f, "subject"), body: String(f.get("body") ?? "") });
  revalidatePath("/review");
}

export async function approve(draftId: string, f: FormData) {
  await approveDraft(draftId, { subject: str(f, "subject"), body: String(f.get("body") ?? "") });
  revalidatePath("/review");
}

export async function reject(draftId: string) {
  await rejectDraft(draftId);
  revalidatePath("/review");
}

export async function regenerate(draftId: string, f: FormData) {
  await regenerateDraft(draftId, str(f, "note") || "Make it sharper and more specific.");
  revalidatePath("/review");
}

export async function pushToOutlook(mailboxId: string) {
  await pushPendingDrafts(mailboxId);
  revalidatePath("/review");
}

export async function sendBatch(mailboxId: string, f: FormData) {
  if (str(f, "confirm") !== "SEND") throw new Error('Type SEND to confirm the batch');
  const ids = f.getAll("draftId").map(String);
  await sendApprovedBatch(mailboxId, ids);
  revalidatePath("/review");
}

export async function syncRepliesNow() {
  await syncAllReplies(dbCallLogger);
  revalidatePath("/");
}

export async function followUpsNow() {
  await runFollowUps(dbCallLogger);
  revalidatePath("/review");
}

// ---------- Mailboxes ----------

export async function saveMailbox(f: FormData) {
  const id = str(f, "id");
  const data = {
    displayName: str(f, "displayName"),
    personaName: str(f, "personaName"),
    personaTone: str(f, "personaTone") || "founder and hands-on consultant, peer to peer, confident and direct",
    signOff: str(f, "signOff") || "Best,",
    signatureHtml: sanitizeSignature(String(f.get("signatureHtml") ?? "")),
    dailyDraftLimit: Math.max(1, Number(str(f, "dailyDraftLimit")) || 50),
    allowSend: f.get("allowSend") === "on",
  };
  if (id) await prisma.mailbox.update({ where: { id }, data });
  else await prisma.mailbox.create({ data: { ...data, email: str(f, "email").toLowerCase() } });
  revalidatePath("/settings/mailboxes");
}

export async function disconnectMailbox(id: string) {
  await prisma.mailbox.update({ where: { id }, data: { encryptedRefreshToken: null, accessToken: null, accessTokenExpiresAt: null, connectedAt: null } });
  revalidatePath("/settings/mailboxes");
}

// ---------- Regions ----------

export async function createRegion(f: FormData) {
  const locations = JSON.parse(str(f, "locations") || "[]") as RegionLocation[];
  if (!str(f, "name") || locations.length === 0) throw new Error("Give the region a name and at least one resolved location");
  const d = regionDefaults(locations);
  await prisma.region.create({
    data: { name: str(f, "name"), locations: locations as unknown as Prisma.InputJsonValue, ...d, defaultMailboxId: str(f, "defaultMailboxId") || null },
  });
  revalidatePath("/settings/regions");
}

export async function updateRegion(id: string, f: FormData) {
  await prisma.region.update({
    where: { id },
    data: {
      name: str(f, "name"),
      timeZone: str(f, "timeZone"),
      currency: str(f, "currency"),
      spelling: str(f, "spelling"),
      complianceNote: str(f, "complianceNote"),
      complianceFooter: String(f.get("complianceFooter") ?? ""),
      defaultMailboxId: str(f, "defaultMailboxId") || null,
    },
  });
  revalidatePath("/settings/regions");
}

export async function deleteRegion(id: string) {
  if (await prisma.campaign.count({ where: { regionId: id } })) throw new Error("Region has campaigns; it can't be deleted");
  await prisma.region.delete({ where: { id } });
  revalidatePath("/settings/regions");
}

// ---------- List types ----------

function configFromForm(f: FormData) {
  const num = (k: string) => (str(f, k) ? Number(str(f, k)) : null);
  return ListTypeConfigSchema.parse({
    description: str(f, "description"),
    audience: str(f, "audience") === "partner" ? "partner" : "end_client",
    industries: lines(str(f, "industries")),
    sizeMin: num("sizeMin"),
    sizeMax: num("sizeMax"),
    signals: lines(String(f.get("signals") ?? "")),
    searchKeywords: lines(String(f.get("searchKeywords") ?? "")),
    useHiringSignals: f.get("useHiringSignals") === "on",
    titles: lines(String(f.get("titles") ?? "")),
    pitch: str(f, "pitch"),
    offer: str(f, "offer"),
    proofPointLabels: lines(str(f, "proofPointLabels")),
    hotCriteria: str(f, "hotCriteria"),
    warmCriteria: str(f, "warmCriteria"),
    exclusions: lines(String(f.get("exclusions") ?? "")),
    emailStyle: str(f, "emailStyle"),
    needsVerticalText: f.get("needsVerticalText") === "on",
  });
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await prisma.listType.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
  return slug;
}

export async function saveListType(f: FormData) {
  const id = str(f, "id");
  const config = configFromForm(f) as Prisma.InputJsonValue;
  if (id) {
    await prisma.listType.update({ where: { id }, data: { name: str(f, "name"), config } });
    revalidatePath("/settings/list-types");
    redirect("/settings/list-types");
  }
  await prisma.listType.create({ data: { name: str(f, "name"), slug: await uniqueSlug(str(f, "name")), config } });
  redirect("/settings/list-types");
}

/** "Describe it in plain English" → Claude drafts the config → the edit form opens for review. */
export async function draftListTypeFromEnglish(f: FormData) {
  const description = str(f, "plain");
  if (!description) throw new Error("Describe the list first");
  const draft = await draftListTypeConfig(new Claude({ logger: dbCallLogger }), description);
  const lt = await prisma.listType.create({
    data: { name: draft.name, slug: await uniqueSlug(draft.name), status: "paused", config: draft.config as Prisma.InputJsonValue },
  });
  redirect(`/settings/list-types/${lt.id}?drafted=1`);
}

export async function duplicateListType(id: string) {
  const lt = await prisma.listType.findUniqueOrThrow({ where: { id } });
  const name = `${lt.name} (copy)`;
  await prisma.listType.create({ data: { name, slug: await uniqueSlug(name), config: lt.config as Prisma.InputJsonValue, status: "paused" } });
  revalidatePath("/settings/list-types");
}

export async function toggleListType(id: string) {
  const lt = await prisma.listType.findUniqueOrThrow({ where: { id } });
  await prisma.listType.update({ where: { id }, data: { status: lt.status === "active" ? "paused" : "active" } });
  revalidatePath("/settings/list-types");
}

export async function deleteListType(id: string) {
  if (await prisma.campaign.count({ where: { listTypeId: id } })) throw new Error("This list has campaigns. Pause it instead.");
  await prisma.listType.delete({ where: { id } });
  revalidatePath("/settings/list-types");
}

// ---------- Proof points, exclusions, voice, general ----------

export async function addProofPoint(f: FormData) {
  await prisma.proofPoint.create({ data: { label: str(f, "label"), text: str(f, "text") } });
  revalidatePath("/settings/proof-points");
}

export async function toggleProofPoint(id: string) {
  const p = await prisma.proofPoint.findUniqueOrThrow({ where: { id } });
  await prisma.proofPoint.update({ where: { id }, data: { active: !p.active } });
  revalidatePath("/settings/proof-points");
}

export async function deleteProofPoint(id: string) {
  await prisma.proofPoint.delete({ where: { id } });
  revalidatePath("/settings/proof-points");
}

export async function addExclusions(f: FormData) {
  const reason = (str(f, "reason") || "blocked") as "blocked" | "client";
  for (const raw of lines(String(f.get("values") ?? ""))) {
    const e = toExclusionEntry(raw);
    if (!e) continue;
    await prisma.exclusion.upsert({ where: { kind_value: { kind: e.kind, value: e.value } }, create: { ...e, reason, note: str(f, "note") }, update: {} });
  }
  revalidatePath("/settings/exclusions");
}

export async function deleteExclusion(id: string) {
  await prisma.exclusion.delete({ where: { id } });
  revalidatePath("/settings/exclusions");
}

export async function saveVoiceGuide(f: FormData) {
  await updateSettings({ voiceGuide: String(f.get("voiceGuide") ?? "") });
  revalidatePath("/settings/voice");
}

/** Seed examples: paste emails separated by a line of "---", or upload .txt/.eml files. */
export async function addVoiceExamples(f: FormData) {
  const texts: string[] = String(f.get("examples") ?? "").split(/\n-{3,}\n/);
  for (const file of f.getAll("files")) if (file instanceof File && file.size > 0) texts.push(await file.text());
  for (const t of texts.map((x) => x.trim()).filter(Boolean)) {
    const m = t.match(/^subject:\s*(.+)\n/i);
    await prisma.voiceExample.create({ data: { kind: "seed", subject: m?.[1]?.trim() ?? "", after: m ? t.slice(m[0].length).trim() : t } });
  }
  revalidatePath("/settings/voice");
}

export async function deleteVoiceExample(id: string) {
  await prisma.voiceExample.delete({ where: { id } });
  revalidatePath("/settings/voice");
}

export async function saveGeneralSettings(f: FormData) {
  const n = (k: string) => Number(str(f, k));
  const patch: Partial<AppSettings> = {
    followUpBusinessDays: n("followUpBusinessDays"),
    maxFollowUps: Math.min(2, n("maxFollowUps")),
    sendTimeLocal: str(f, "sendTimeLocal"),
    confirmAboveUsd: n("confirmAboveUsd"),
    confirmAboveCredits: n("confirmAboveCredits"),
    braveUsdPerQuery: n("braveUsdPerQuery"),
    physicalAddress: str(f, "physicalAddress"),
    visitsPerDay: n("visitsPerDay"),
  };
  await updateSettings(patch);
  revalidatePath("/settings/general");
}
