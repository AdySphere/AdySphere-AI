import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

// Every external call (provider, cost, timestamp) goes through a CallLogger.

export type CallRecord = {
  provider: "anthropic" | "apollo" | "brave" | "graph" | "nominatim" | "web";
  operation: string;
  cost?: number;
  costUnit?: "usd" | "credits" | "queries" | "none";
  status?: "ok" | "error";
  campaignId?: string | null;
  meta?: Record<string, unknown>;
};

export interface CallLogger {
  log(rec: CallRecord): Promise<void>;
}

export const dbCallLogger: CallLogger = {
  async log(rec) {
    await prisma.externalCall.create({
      data: {
        provider: rec.provider,
        operation: rec.operation,
        cost: rec.cost ?? 0,
        costUnit: rec.costUnit ?? "none",
        status: rec.status ?? "ok",
        campaignId: rec.campaignId ?? null,
        meta: (rec.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  },
};

export class MemoryCallLogger implements CallLogger {
  calls: CallRecord[] = [];
  async log(rec: CallRecord) {
    this.calls.push(rec);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
