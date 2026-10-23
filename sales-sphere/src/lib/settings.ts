import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { DEFAULT_VOICE_GUIDE } from "./voice";

export type AppSettings = {
  voiceGuide: string;
  followUpBusinessDays: number;
  maxFollowUps: number;
  sendTimeLocal: string; // "08:30" in the prospect's time zone
  // Ask before a run whose estimated paid spend exceeds this
  confirmAboveUsd: number;
  // Ask before any Apollo enrichment that needs more than this many credits (0 = always ask)
  confirmAboveCredits: number;
  braveUsdPerQuery: number;
  physicalAddress: string; // required in US (CAN-SPAM) footers
  visitsPerDay: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  voiceGuide: DEFAULT_VOICE_GUIDE,
  followUpBusinessDays: 4,
  maxFollowUps: 2,
  sendTimeLocal: "08:30",
  confirmAboveUsd: 5,
  confirmAboveCredits: 0,
  braveUsdPerQuery: 0.005,
  physicalAddress: "",
  visitsPerDay: 6,
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) merged[r.key] = r.value;
  return merged as AppSettings;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
  }
}
