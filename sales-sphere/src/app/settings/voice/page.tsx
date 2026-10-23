import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { addVoiceExamples, deleteVoiceExample, saveVoiceGuide } from "../../actions";
import { SettingsNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function Voice() {
  const [settings, examples] = await Promise.all([getSettings(), prisma.voiceExample.findMany({ orderBy: { createdAt: "desc" } })]);
  const seeds = examples.filter((e) => e.kind === "seed");
  const edits = examples.filter((e) => e.kind === "edit");
  return (
    <>
      <h1>Voice</h1>
      <SettingsNav />
      <form action={saveVoiceGuide} className="panel">
        <label>Voice guide <span className="muted">(every draft follows this)</span></label>
        <textarea name="voiceGuide" defaultValue={settings.voiceGuide} rows={16} />
        <div className="actions"><button>Save</button></div>
      </form>

      <form action={addVoiceExamples} className="panel">
        <h2>Seed examples ({seeds.length}) <span className="muted">5-10 emails you wrote and approved</span></h2>
        <label>Paste emails, separated by a line with ---. Optional first line "Subject: ..."</label>
        <textarea name="examples" rows={8} />
        <label>Or upload .txt files</label>
        <input type="file" name="files" accept=".txt,.eml,text/plain" multiple />
        <div className="actions"><button>Add examples</button></div>
      </form>
      {seeds.map((e) => (
        <div className="panel" key={e.id}>
          {e.subject && <b>{e.subject}</b>}
          <pre style={{ whiteSpace: "pre-wrap", font: "inherit" }}>{e.after}</pre>
          <form action={deleteVoiceExample.bind(null, e.id)}><button className="secondary">Remove</button></form>
        </div>
      ))}

      <h2>Learned from your edits ({edits.length})</h2>
      <p className="muted">Saved when you edit a draft before approving it. The latest 6 are used as examples.</p>
      {edits.slice(0, 20).map((e) => (
        <div className="panel draft" key={e.id}>
          <div><span className="muted">Before</span><pre style={{ whiteSpace: "pre-wrap", font: "inherit" }}>{e.before}</pre></div>
          <div><span className="muted">After</span><pre style={{ whiteSpace: "pre-wrap", font: "inherit" }}>{e.after}</pre>
            <form action={deleteVoiceExample.bind(null, e.id)}><button className="secondary">Forget</button></form></div>
        </div>
      ))}
    </>
  );
}
