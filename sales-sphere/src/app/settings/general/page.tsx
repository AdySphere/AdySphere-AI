import { getSettings } from "@/lib/settings";
import { saveGeneralSettings } from "../../actions";
import { SettingsNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function General() {
  const s = await getSettings();
  return (
    <>
      <h1>General</h1>
      <SettingsNav />
      <form action={saveGeneralSettings} className="panel">
        <h2>Guardrails</h2>
        <div className="row">
          <div><label>Ask before runs estimated over (USD)</label><input name="confirmAboveUsd" type="number" step="0.5" defaultValue={s.confirmAboveUsd} /></div>
          <div><label>Ask before enrichment over (credits)</label><input name="confirmAboveCredits" type="number" defaultValue={s.confirmAboveCredits} /></div>
          <div><label>Brave cost per query (USD)</label><input name="braveUsdPerQuery" type="number" step="0.001" defaultValue={s.braveUsdPerQuery} /></div>
        </div>
        <h2>Timing</h2>
        <div className="row">
          <div><label>Send time (prospect&apos;s local)</label><input name="sendTimeLocal" defaultValue={s.sendTimeLocal} pattern="\d{2}:\d{2}" /></div>
          <div><label>Follow up after (business days)</label><input name="followUpBusinessDays" type="number" defaultValue={s.followUpBusinessDays} /></div>
          <div><label>Max follow-ups (≤ 2)</label><input name="maxFollowUps" type="number" min={0} max={2} defaultValue={s.maxFollowUps} /></div>
          <div><label>Field visits per day</label><input name="visitsPerDay" type="number" defaultValue={s.visitsPerDay} /></div>
        </div>
        <h2>Compliance</h2>
        <label>Physical postal address <span className="muted">(required by CAN-SPAM in US emails; US drafts are blocked until it&apos;s set)</span></label>
        <input name="physicalAddress" defaultValue={s.physicalAddress} />
        <div className="actions"><button>Save</button></div>
      </form>
    </>
  );
}
