import { prisma } from "@/lib/db";
import { buildWorkbook, campaignRows } from "@/lib/export/excel";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id }, include: { region: true, listType: true } });
  const buf = await buildWorkbook(await campaignRows(id), `${c.region.name} ${c.listType.slug}`);
  const name = `${c.region.name}-${c.listType.slug}-${c.createdAt.toISOString().slice(0, 10)}.xlsx`.replace(/[^\w.-]+/g, "_");
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"` },
  });
}
