import { prisma } from "@/lib/db";
import { createRegion, deleteRegion, updateRegion } from "../../actions";
import { SettingsNav } from "../nav";
import { RegionBuilder } from "./RegionBuilder";
import type { RegionLocation } from "@/lib/geo/regions";

export const dynamic = "force-dynamic";

export default async function Regions() {
  const [regions, mailboxes] = await Promise.all([
    prisma.region.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { campaigns: true } } } }),
    prisma.mailbox.findMany({ orderBy: { email: "asc" } }),
  ]);
  const mailboxSelect = (value?: string | null) => (
    <select name="defaultMailboxId" defaultValue={value ?? ""}>
      <option value="">None</option>
      {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
    </select>
  );
  return (
    <>
      <h1>Regions</h1>
      <SettingsNav />
      <form action={createRegion} className="panel">
        <h2>New region</h2>
        <div className="row">
          <div><label>Name</label><input name="name" required placeholder="KSA" /></div>
          <div><label>Default mailbox</label>{mailboxSelect()}</div>
        </div>
        <RegionBuilder />
        <div className="actions"><button>Save region</button></div>
      </form>

      {regions.map((r) => (
        <form key={r.id} action={updateRegion.bind(null, r.id)} className="panel">
          <div className="row">
            <div><label>Name</label><input name="name" defaultValue={r.name} /></div>
            <div><label>Time zone</label><input name="timeZone" defaultValue={r.timeZone} /></div>
            <div style={{ flex: "0 1 100px" }}><label>Currency</label><input name="currency" defaultValue={r.currency} /></div>
            <div style={{ flex: "0 1 120px" }}><label>Spelling</label>
              <select name="spelling" defaultValue={r.spelling}><option value="en-GB">UK English</option><option value="en-US">US English</option></select>
            </div>
            <div><label>Default mailbox</label>{mailboxSelect(r.defaultMailboxId)}</div>
          </div>
          <p className="muted">Locations: {(r.locations as unknown as RegionLocation[]).map((l) => (l.radiusKm ? `${l.radiusKm} km around ${l.label.split(",")[0]}` : l.label.split(",").slice(0, 2).join(","))).join(" · ")}</p>
          <label>Compliance note</label>
          <input name="complianceNote" defaultValue={r.complianceNote} />
          <label>Compliance footer <span className="muted">(added to every email; {"{{physical_address}}"} comes from Settings → General)</span></label>
          <textarea name="complianceFooter" defaultValue={r.complianceFooter} rows={2} />
          <div className="actions">
            <button>Save</button>
            {r._count.campaigns === 0 && <button formAction={deleteRegion.bind(null, r.id)} className="danger">Delete</button>}
          </div>
        </form>
      ))}
    </>
  );
}
