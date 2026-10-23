import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const after = req.nextUrl.searchParams.get("after");
  const [campaign, logs] = await Promise.all([
    prisma.campaign.findUniqueOrThrow({ where: { id }, select: { status: true, creditsUsed: true, estimatedCredits: true } }),
    prisma.campaignLog.findMany({ where: { campaignId: id, ...(after ? { createdAt: { gt: new Date(after) } } : {}) }, orderBy: { createdAt: "asc" }, take: 500 }),
  ]);
  return NextResponse.json({ campaign, logs });
}
