import Link from "next/link";
import { prisma } from "@/lib/db";
import { parseListTypeConfig } from "@/lib/listTypes/schema";
import { deleteListType, draftListTypeFromEnglish, duplicateListType, toggleListType } from "../../actions";
import { SettingsNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function ListTypes() {
  const lists = await prisma.listType.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { campaigns: true } } } });
  return (
    <>
      <h1>List types</h1>
      <SettingsNav />
      <form action={draftListTypeFromEnglish} className="panel">
        <label>Describe a new list in plain English</label>
        <textarea name="plain" placeholder="e.g. Family-owned food distributors in the GCC with 50-300 staff that are still on Tally or Excel. Pitch Business Central with a Business X-Ray first. Hot if they're opening a new warehouse." />
        <div className="actions"><button>Draft it with Claude</button><Link className="btn secondary" href="/settings/list-types/new">Or fill in the form</Link></div>
        <p className="muted">Claude drafts the whole config; it's saved paused so you can review it before using it.</p>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Slug</th><th>Audience</th><th>Status</th><th>Campaigns</th><th></th></tr></thead>
        <tbody>
          {lists.map((l) => {
            const c = parseListTypeConfig(l.config);
            return (
              <tr key={l.id}>
                <td><Link href={`/settings/list-types/${l.id}`}><b>{l.name}</b></Link><br /><span className="muted">{c.description}</span></td>
                <td>{l.slug}</td>
                <td>{c.audience === "partner" ? "Partners" : "End clients"}</td>
                <td><span className="pill">{l.status}</span></td>
                <td>{l._count.campaigns}</td>
                <td>
                  <div className="actions">
                    <Link className="btn secondary" href={`/settings/list-types/${l.id}`}>Edit</Link>
                    <form action={duplicateListType.bind(null, l.id)}><button className="secondary">Duplicate</button></form>
                    <form action={toggleListType.bind(null, l.id)}><button className="secondary">{l.status === "active" ? "Pause" : "Activate"}</button></form>
                    {l._count.campaigns === 0 && <form action={deleteListType.bind(null, l.id)}><button className="danger">Delete</button></form>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
