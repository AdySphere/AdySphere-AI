import { prisma } from "@/lib/db";
import { addExclusions, deleteExclusion } from "../../actions";
import { SettingsNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function Exclusions() {
  const rows = await prisma.exclusion.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <>
      <h1>Do-not-contact list</h1>
      <SettingsNav />
      <p className="muted">Blocked companies and domains, current clients, anyone who said not interested, and anything you reject in review. Checked on every run, across all campaigns and mailboxes.</p>
      <form action={addExclusions} className="panel">
        <label>Companies or domains <span className="muted">(one per line)</span></label>
        <textarea name="values" placeholder={"Business Experts MEA\nacme.com"} />
        <div className="row">
          <div><label>Reason</label><select name="reason"><option value="blocked">Blocked</option><option value="client">Current client</option></select></div>
          <div><label>Note</label><input name="note" /></div>
        </div>
        <div className="actions"><button>Add</button></div>
      </form>
      <table>
        <thead><tr><th>Value</th><th>Kind</th><th>Reason</th><th>Note</th><th>Added</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.value}</td><td>{r.kind}</td><td>{r.reason.replace(/_/g, " ")}</td><td className="muted">{r.note}</td><td>{r.createdAt.toISOString().slice(0, 10)}</td>
              <td><form action={deleteExclusion.bind(null, r.id)}><button className="secondary">Remove</button></form></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
