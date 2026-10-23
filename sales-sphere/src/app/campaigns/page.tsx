import Link from "next/link";
import { prisma } from "@/lib/db";
import { createCampaign } from "../actions";
import { parseListTypeConfig } from "@/lib/listTypes/schema";

export const dynamic = "force-dynamic";

export default async function Campaigns() {
  const [regions, listTypes, mailboxes, campaigns] = await Promise.all([
    prisma.region.findMany({ orderBy: { name: "asc" }, include: { defaultMailbox: true } }),
    prisma.listType.findMany({ where: { status: "active" }, orderBy: { name: "asc" } }),
    prisma.mailbox.findMany({ orderBy: { email: "asc" } }),
    prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { region: true, listType: true, _count: { select: { prospects: true } } } }),
  ]);
  const verticalLists = listTypes.filter((l) => parseListTypeConfig(l.config).needsVerticalText).map((l) => l.name);
  return (
    <>
      <h1>Campaigns</h1>
      <form action={createCampaign} className="panel">
        <div className="row">
          <div>
            <label>Region</label>
            <select name="regionId" required>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.name}{r.defaultMailbox ? ` (${r.defaultMailbox.email})` : ""}</option>)}
            </select>
          </div>
          <div>
            <label>List type</label>
            <select name="listTypeId" required>
              {listTypes.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.slug})</option>)}
            </select>
          </div>
          <div style={{ flex: "0 1 120px" }}>
            <label>Target count</label>
            <input name="targetCount" type="number" min={1} max={500} defaultValue={25} />
          </div>
          <div>
            <label>Mailbox</label>
            <select name="mailboxId" defaultValue="">
              <option value="">Region default</option>
              {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
            </select>
          </div>
        </div>
        <label>Vertical <span className="muted">(required for: {verticalLists.join(", ") || "none"})</span></label>
        <input name="verticalText" placeholder='e.g. "dental groups", "food distributors"' />
        <div className="actions"><button>Run campaign</button></div>
        <p className="muted">You'll see a spend estimate first. Apollo email enrichment always asks before spending credits. Nothing is sent: drafts land in Outlook and the review queue.</p>
      </form>

      <table>
        <thead><tr><th>Created</th><th>Region</th><th>List</th><th>Target</th><th>Prospects</th><th>Status</th><th>Credits</th></tr></thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/campaigns/${c.id}`}>{c.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Link></td>
              <td>{c.region.name}</td>
              <td>{c.listType.name}{c.verticalText ? `: ${c.verticalText}` : ""}</td>
              <td>{c.targetCount}</td>
              <td>{c._count.prospects}</td>
              <td><span className="pill">{c.status.replace(/_/g, " ")}</span></td>
              <td>{c.creditsUsed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
