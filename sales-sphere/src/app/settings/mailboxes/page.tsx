import { prisma } from "@/lib/db";
import { disconnectMailbox, saveMailbox } from "../../actions";
import { SettingsNav } from "../nav";
import type { Mailbox } from "@prisma/client";

export const dynamic = "force-dynamic";

function MailboxForm({ m }: { m?: Mailbox }) {
  return (
    <form action={saveMailbox} className="panel">
      {m && <input type="hidden" name="id" value={m.id} />}
      <div className="row">
        <div><label>Email</label><input name="email" type="email" defaultValue={m?.email} readOnly={Boolean(m)} required /></div>
        <div><label>Display name</label><input name="displayName" defaultValue={m?.displayName} required /></div>
        <div><label>Sign-off name</label><input name="personaName" defaultValue={m?.personaName} required placeholder="Adyasha" /></div>
        <div><label>Sign-off</label><input name="signOff" defaultValue={m?.signOff ?? "Best,"} /></div>
        <div style={{ flex: "0 1 120px" }}><label>Daily draft limit</label><input name="dailyDraftLimit" type="number" defaultValue={m?.dailyDraftLimit ?? 50} /></div>
      </div>
      <label>Persona (tone)</label>
      <input name="personaTone" defaultValue={m?.personaTone} placeholder="founder and hands-on consultant, peer to peer, confident and direct" />
      <label>Signature HTML <span className="muted">(HTML table, no images)</span></label>
      <textarea name="signatureHtml" defaultValue={m?.signatureHtml} rows={5} />
      <label style={{ fontWeight: 400 }}><input type="checkbox" name="allowSend" defaultChecked={m?.allowSend} /> Allow send <span className="muted">(off by default; each batch still needs approval in the review queue; reconnect after turning on so Mail.Send is granted)</span></label>
      <div className="actions"><button>{m ? "Save" : "Add mailbox"}</button></div>
    </form>
  );
}

export default async function Mailboxes({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const mailboxes = await prisma.mailbox.findMany({ orderBy: { email: "asc" }, include: { regions: true } });
  return (
    <>
      <h1>Mailboxes</h1>
      <SettingsNav />
      {msg && <div className="notice">{msg}</div>}
      {mailboxes.map((m) => (
        <div key={m.id}>
          <h2>{m.email} {m.encryptedRefreshToken ? <span className="ok">connected {m.connectedAt?.toISOString().slice(0, 10)}</span> : <span className="err">not connected</span>}</h2>
          <p className="muted">Default for: {m.regions.map((r) => r.name).join(", ") || "no regions"}</p>
          <div className="actions">
            <a className="btn" href={`/api/auth/microsoft/start?mailboxId=${m.id}`}>{m.encryptedRefreshToken ? "Reconnect" : "Connect"} with Microsoft</a>
            {m.encryptedRefreshToken && <form action={disconnectMailbox.bind(null, m.id)}><button className="secondary">Disconnect</button></form>}
          </div>
          <MailboxForm m={m} />
        </div>
      ))}
      <h2>Add a mailbox</h2>
      <MailboxForm />
    </>
  );
}
