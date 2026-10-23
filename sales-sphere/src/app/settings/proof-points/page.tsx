import { prisma } from "@/lib/db";
import { addProofPoint, deleteProofPoint, toggleProofPoint } from "../../actions";
import { SettingsNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function ProofPoints() {
  const points = await prisma.proofPoint.findMany({ orderBy: { createdAt: "asc" } });
  return (
    <>
      <h1>Proof points</h1>
      <SettingsNav />
      <p className="muted">The only claims about AdySphere Claude may use. Add real clients and results here; nothing else gets mentioned.</p>
      <form action={addProofPoint} className="panel row">
        <div style={{ flex: "0 1 220px" }}><label>Label</label><input name="label" required placeholder="Logistics BC rollout" /></div>
        <div><label>Text (first person)</label><input name="text" required placeholder="I moved a 60-person logistics firm from Excel to Business Central in 10 weeks." /></div>
        <div style={{ flex: "0 0 auto" }}><button>Add</button></div>
      </form>
      <table>
        <tbody>
          {points.map((p) => (
            <tr key={p.id}>
              <td><b>{p.label}</b></td><td>{p.text}</td><td>{p.active ? "active" : <span className="muted">inactive</span>}</td>
              <td className="actions">
                <form action={toggleProofPoint.bind(null, p.id)}><button className="secondary">{p.active ? "Disable" : "Enable"}</button></form>
                <form action={deleteProofPoint.bind(null, p.id)}><button className="danger">Delete</button></form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
