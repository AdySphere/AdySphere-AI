import type { ListTypeConfig } from "@/lib/listTypes/schema";
import { saveListType } from "../../actions";

const join = (a: string[]) => a.join("\n");

export function ListTypeForm({ id, name, config }: { id?: string; name?: string; config?: ListTypeConfig }) {
  const c = config;
  return (
    <form action={saveListType} className="panel">
      {id && <input type="hidden" name="id" value={id} />}
      <div className="row">
        <div><label>List name</label><input name="name" defaultValue={name} required /></div>
        <div><label>Audience</label>
          <select name="audience" defaultValue={c?.audience ?? "end_client"}><option value="end_client">End clients</option><option value="partner">Microsoft partners</option></select>
        </div>
        <div style={{ flex: "0 1 110px" }}><label>Min staff</label><input name="sizeMin" type="number" defaultValue={c?.sizeMin ?? ""} /></div>
        <div style={{ flex: "0 1 110px" }}><label>Max staff</label><input name="sizeMax" type="number" defaultValue={c?.sizeMax ?? ""} /></div>
      </div>
      <label>Description</label>
      <input name="description" defaultValue={c?.description} />
      <h2>Who to target</h2>
      <div className="row">
        <div><label>Industries <span className="muted">(one per line)</span></label><textarea name="industries" defaultValue={join(c?.industries ?? [])} /></div>
        <div><label>Signals to look for</label><textarea name="signals" defaultValue={join(c?.signals ?? [])} /></div>
      </div>
      <div className="row">
        <div><label>Titles to contact <span className="muted">(priority order)</span></label><textarea name="titles" defaultValue={join(c?.titles ?? [])} /></div>
        <div><label>Search keywords</label><textarea name="searchKeywords" defaultValue={join(c?.searchKeywords ?? [])} /></div>
      </div>
      <label style={{ fontWeight: 400 }}><input type="checkbox" name="useHiringSignals" defaultChecked={c?.useHiringSignals ?? false} /> Search job postings for hiring signals</label>
      <label style={{ fontWeight: 400 }}><input type="checkbox" name="needsVerticalText" defaultChecked={c?.needsVerticalText ?? false} /> Each campaign types its own vertical</label>
      <h2>What to pitch</h2>
      <label>Pitch</label><textarea name="pitch" defaultValue={c?.pitch} rows={2} />
      <div className="row">
        <div><label>Offer / next step</label><input name="offer" defaultValue={c?.offer} /></div>
        <div><label>Proof points to use <span className="muted">(labels, comma separated; empty = all active)</span></label><input name="proofPointLabels" defaultValue={(c?.proofPointLabels ?? []).join(", ")} /></div>
      </div>
      <h2>Hot vs warm</h2>
      <div className="row">
        <div><label>Hot</label><textarea name="hotCriteria" defaultValue={c?.hotCriteria} rows={2} /></div>
        <div><label>Warm</label><textarea name="warmCriteria" defaultValue={c?.warmCriteria} rows={2} /></div>
      </div>
      <label>Exclusions <span className="muted">(one per line: company names, domains, or kinds of company)</span></label>
      <textarea name="exclusions" defaultValue={join(c?.exclusions ?? [])} />
      <label>Email style notes</label>
      <input name="emailStyle" defaultValue={c?.emailStyle} />
      <div className="actions"><button>Save list</button></div>
    </form>
  );
}
