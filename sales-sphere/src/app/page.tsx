import Link from "next/link";
import { dashboardStats, type StatRow } from "@/lib/stats";
import { syncRepliesNow } from "./actions";

export const dynamic = "force-dynamic";

function Table({ title, rows }: { title: string; rows: StatRow[] }) {
  return (
    <>
      <h2>{title}</h2>
      <table>
        <thead><tr><th></th><th>Drafts</th><th>Sent</th><th>Replies</th><th>Meetings</th><th>Apollo credits</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}><td>{r.label}</td><td>{r.drafts}</td><td>{r.sent}</td><td>{r.replies}</td><td>{r.meetings}</td><td>{r.credits}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default async function Dashboard() {
  const s = await dashboardStats();
  return (
    <>
      <h1>Dashboard</h1>
      <div className="grid">
        <div className="stat"><b>{s.total.drafts}</b><span>Drafts created</span></div>
        <div className="stat"><b>{s.total.sent}</b><span>Sent</span></div>
        <div className="stat"><b>{s.total.replies}</b><span>Replies</span></div>
        <div className="stat"><b>{s.total.meetings}</b><span>Meetings booked</span></div>
        <div className="stat"><b>{s.total.credits}</b><span>Apollo credits used</span></div>
        <div className="stat"><b>${s.usdSpent.toFixed(2)}</b><span>Claude + search spend</span></div>
      </div>
      <div className="actions">
        <Link className="btn" href="/campaigns">New campaign</Link>
        <form action={syncRepliesNow}><button className="secondary">Check replies now</button></form>
      </div>
      <Table title="By mailbox" rows={s.byMailbox} />
      <Table title="By region" rows={s.byRegion} />
      <Table title="By list type" rows={s.byList} />
    </>
  );
}
