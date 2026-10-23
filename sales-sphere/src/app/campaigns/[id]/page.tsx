import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { LiveLog } from "../../components/LiveLog";
import { cancelCampaign, confirmStage, resumeCampaign, skipEnrich, toggleMeeting } from "../../actions";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.campaign.findUnique({
    where: { id },
    include: {
      region: { include: { defaultMailbox: true } }, listType: true, mailbox: true,
      logs: { orderBy: { createdAt: "asc" }, take: 500 },
      prospects: { include: { company: true, contact: true, drafts: true }, orderBy: { score: "desc" } },
    },
  });
  if (!c) notFound();
  const pending = c.pendingConfirmation as { stage?: string; message?: string } | null;
  const mailbox = c.mailbox ?? c.region.defaultMailbox;

  return (
    <>
      <h1>{c.region.name} · {c.listType.name}{c.verticalText ? `: ${c.verticalText}` : ""} · {c.targetCount}</h1>
      <p className="muted">Mailbox: {mailbox?.email ?? "none"} · Apollo credits used: {c.creditsUsed}{c.estimatedCredits ? ` (estimated ${c.estimatedCredits})` : ""} · Estimated spend ~${c.estimatedUsd.toFixed(2)}</p>

      {c.status === "awaiting_run_confirmation" && (
        <div className="notice">
          <p>{pending?.message}</p>
          <div className="actions">
            <form action={confirmStage.bind(null, c.id, "run")}><button>Confirm and run</button></form>
            <form action={cancelCampaign.bind(null, c.id)}><button className="secondary">Cancel</button></form>
          </div>
        </div>
      )}
      {c.status === "awaiting_enrich_confirmation" && (
        <div className="notice">
          <p>{pending?.message}</p>
          <div className="actions">
            <form action={confirmStage.bind(null, c.id, "enrich")}><button>Spend up to {c.estimatedCredits} credits</button></form>
            <form action={skipEnrich.bind(null, c.id)}><button className="secondary">Skip enrichment</button></form>
          </div>
        </div>
      )}
      {c.status === "failed" && (
        <div className="notice">
          <p className="err">{c.error}</p>
          <form action={resumeCampaign.bind(null, c.id)}><button>Resume</button></form>
        </div>
      )}

      <LiveLog campaignId={c.id} initialStatus={c.status} initial={c.logs.map((l) => ({ id: l.id, level: l.level, message: l.message, createdAt: l.createdAt.toISOString() }))} />

      <div className="actions">
        <a className="btn secondary" href={`/api/campaigns/${c.id}/export`}>Excel export</a>
        <Link className="btn secondary" href={`/campaigns/${c.id}/field-visit`}>Field-visit sheet</Link>
        <Link className="btn secondary" href="/review">Review queue</Link>
      </div>

      <h2>Prospects ({c.prospects.length})</h2>
      <table>
        <thead><tr><th>Tier</th><th>Company</th><th>Why now</th><th>Contact</th><th>Status</th><th>Source</th><th>Meeting</th></tr></thead>
        <tbody>
          {c.prospects.map((p) => {
            const src = (p.evidence as { url: string }[])[0]?.url;
            return (
              <tr key={p.id} className={p.tier ?? ""}>
                <td>{p.tier?.toUpperCase()} {p.score}</td>
                <td><b>{p.company.name}</b><br /><span className="muted">{p.company.domain}{p.company.location ? ` · ${p.company.location}` : ""}</span></td>
                <td>{p.whyNow}<br /><span className="muted">{p.confidence} confidence</span></td>
                <td>{p.contact ? <>{p.contact.name}<br /><span className="muted">{p.contact.title}<br />{p.contact.email ?? p.contact.emailStatus}</span></> : "-"}</td>
                <td>{p.status === "linkedin_phone_only" ? "LinkedIn/phone only" : p.status.replace(/_/g, " ")}{p.replySummary ? <><br /><span className="muted">{p.replySummary}</span></> : null}</td>
                <td>{src ? <a href={src} target="_blank" rel="noreferrer">evidence</a> : "-"}</td>
                <td><form action={toggleMeeting.bind(null, p.id)}><button className="secondary">{p.meetingBooked ? "✓ booked" : "mark"}</button></form></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
