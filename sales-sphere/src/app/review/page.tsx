import Link from "next/link";
import { prisma } from "@/lib/db";
import { approve, followUpsNow, pushToOutlook, regenerate, reject, saveDraft, sendBatch } from "../actions";
import { draftsCreatedToday } from "@/lib/drafts/service";
import { checkVoiceRules, wordCount } from "@/lib/voice";

export const dynamic = "force-dynamic";

export default async function Review({ searchParams }: { searchParams: Promise<{ mailbox?: string; status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status === "approved" ? "approved" : "pending_review";
  const mailboxes = await prisma.mailbox.findMany({ orderBy: { email: "asc" } });
  const drafts = await prisma.draft.findMany({
    where: { status, ...(sp.mailbox ? { mailboxId: sp.mailbox } : {}) },
    include: { mailbox: true, prospect: { include: { company: true, contact: true, campaign: { include: { region: true, listType: true } } } } },
    orderBy: [{ createdAt: "asc" }],
    take: 100,
  });
  const today = Object.fromEntries(await Promise.all(mailboxes.map(async (m) => [m.id, await draftsCreatedToday(m.id)] as const)));
  const approvedByMailbox = await prisma.draft.groupBy({ by: ["mailboxId"], where: { status: "approved" }, _count: true });
  const notPushed = await prisma.draft.groupBy({ by: ["mailboxId"], where: { status: { in: ["pending_review", "approved"] }, graphMessageId: null }, _count: true });

  return (
    <>
      <h1>Review queue</h1>
      <nav className="sub">
        <Link href="/review">Pending review</Link>
        <Link href="/review?status=approved">Approved</Link>
        {mailboxes.map((m) => <Link key={m.id} href={`/review?status=${status}&mailbox=${m.id}`}>{m.email}</Link>)}
        <form action={followUpsNow}><button className="secondary">Draft due follow-ups</button></form>
      </nav>

      <div className="panel">
        <table>
          <thead><tr><th>Mailbox</th><th>Drafts today</th><th>Not in Outlook yet</th><th>Approved</th><th></th></tr></thead>
          <tbody>
            {mailboxes.map((m) => {
              const waiting = notPushed.find((x) => x.mailboxId === m.id)?._count ?? 0;
              const approvedCount = approvedByMailbox.find((x) => x.mailboxId === m.id)?._count ?? 0;
              return (
                <tr key={m.id}>
                  <td>{m.email} {m.encryptedRefreshToken ? <span className="ok">connected</span> : <span className="err">not connected</span>}</td>
                  <td>{today[m.id]} / {m.dailyDraftLimit}</td>
                  <td>{waiting} {waiting > 0 && m.encryptedRefreshToken && <form action={pushToOutlook.bind(null, m.id)} style={{ display: "inline" }}><button className="secondary">Push to Outlook</button></form>}</td>
                  <td>{approvedCount}</td>
                  <td>{m.allowSend ? <span className="muted">sending allowed</span> : <span className="muted">drafts only</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {status === "approved" && mailboxes.filter((m) => m.allowSend).map((m) => {
        const mine = drafts.filter((d) => d.mailboxId === m.id);
        if (mine.length === 0) return null;
        return (
          <form key={m.id} action={sendBatch.bind(null, m.id)} className="panel">
            <h2>Send approved batch from {m.email}</h2>
            <p className="muted">Each email is delivered at its scheduled local-morning time. Untick any you want to hold back.</p>
            {mine.map((d) => (
              <label key={d.id} style={{ fontWeight: 400 }}>
                <input type="checkbox" name="draftId" value={d.id} defaultChecked /> {d.prospect.company.name}: {d.subject} → {d.toEmail} ({d.scheduledFor?.toISOString().slice(0, 16).replace("T", " ")} UTC)
              </label>
            ))}
            <label>Type SEND to confirm</label>
            <input name="confirm" autoComplete="off" style={{ maxWidth: 200 }} />
            <div className="actions"><button className="danger">Send {mine.length} emails</button></div>
          </form>
        );
      })}

      {drafts.length === 0 && <p className="muted">Nothing here.</p>}
      {drafts.map((d) => {
        const p = d.prospect;
        const problems = checkVoiceRules({ subject: d.subject, body: d.body }, d.kind === "initial" ? { minWords: 80, maxWords: 130 } : { minWords: 15, maxWords: 75 });
        return (
          <div className="panel draft" key={d.id}>
            <form action={approve.bind(null, d.id)}>
              <label>Subject</label>
              <input name="subject" defaultValue={d.subject} readOnly={d.kind !== "initial"} />
              <label>Body <span className="muted">({wordCount(d.body)} words; sign-off and signature are added automatically)</span></label>
              <textarea name="body" defaultValue={d.body} rows={12} />
              {problems.length > 0 && <p className="err">{problems.join(" ")}</p>}
              <div className="actions">
                {status === "pending_review" && <button>Approve</button>}
                <button formAction={saveDraft.bind(null, d.id)} className="secondary">Save edits</button>
                <button formAction={reject.bind(null, d.id)} className="danger">Reject + exclude company</button>
              </div>
            </form>
            <div>
              <p><span className={`pill ${p.tier ?? ""}`}>{p.tier?.toUpperCase()} {p.score}</span> <span className="pill">{d.kind}</span></p>
              <p><b>{p.company.name}</b> <span className="muted">{p.company.domain}</span><br />
                To: {p.contact?.name} ({p.contact?.title}) &lt;{d.toEmail}&gt;<br />
                From: {d.mailbox.email}<br />
                {p.campaign.region.name} · {p.campaign.listType.name}<br />
                Scheduled: {d.scheduledFor?.toLocaleString("en-GB", { timeZone: p.campaign.region.timeZone })} ({p.campaign.region.timeZone})<br />
                {d.graphMessageId ? <span className="ok">In Outlook drafts</span> : <span className="muted">Not in Outlook yet</span>}</p>
              <p className="muted">Why now: {p.whyNow}</p>
              <ul>{(p.evidence as { url: string; title?: string }[]).slice(0, 4).map((e) => <li key={e.url}><a href={e.url} target="_blank" rel="noreferrer">{e.title || e.url}</a></li>)}</ul>
              {d.kind === "initial" && (
                <form action={regenerate.bind(null, d.id)}>
                  <label>Regenerate with a note</label>
                  <input name="note" placeholder="e.g. lead with the Business X-Ray, shorter" />
                  <div className="actions"><button className="secondary">Regenerate</button></div>
                </form>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
