import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { mapsLink, planFieldVisits } from "@/lib/export/fieldVisit";

export const dynamic = "force-dynamic";

export default async function FieldVisit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ perDay?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await prisma.campaign.findUnique({ where: { id }, include: { region: true, listType: true, prospects: { include: { company: true, contact: true } } } });
  if (!c) notFound();
  const perDay = Number(sp.perDay) || (await getSettings()).visitsPerDay;
  const days = planFieldVisits(
    c.prospects
      .filter((p) => !["rejected", "not_interested", "bounced"].includes(p.status))
      .map((p) => ({
        company: p.company.name,
        area: p.company.area ?? p.company.location ?? "",
        address: p.company.address,
        phone: p.company.phone,
        hours: p.company.hours,
        tier: p.tier,
        contact: p.contact ? `${p.contact.name}${p.contact.title ? `, ${p.contact.title}` : ""}` : null,
        mapUrl: mapsLink(p.company.address, `${p.company.name} ${p.company.location ?? ""}`),
      })),
    perDay,
  );
  return (
    <>
      <h1>Field visits · {c.region.name} · {c.listType.name}</h1>
      <form className="noprint row" style={{ maxWidth: 400 }}>
        <div><label>Visits per day</label><input name="perDay" type="number" defaultValue={perDay} min={1} /></div>
        <div><button>Update</button></div>
      </form>
      <p className="muted noprint">Grouped by area, hot leads first. Print this page for a route sheet.</p>
      {days.map((d) => (
        <div className="panel" key={d.day}>
          <h2>Day {d.day} · {d.area || "Unknown area"}</h2>
          <table>
            <thead><tr><th>#</th><th>Company</th><th>Address</th><th>Hours</th><th>Phone</th><th>Contact</th></tr></thead>
            <tbody>
              {d.stops.map((s, i) => (
                <tr key={s.company} className={s.tier ?? ""}>
                  <td>{i + 1}</td>
                  <td><b>{s.company}</b> <span className="muted">{s.tier}</span></td>
                  <td>{s.address ?? <span className="muted">not known</span>} {s.mapUrl && <a href={s.mapUrl} target="_blank" rel="noreferrer">map</a>}</td>
                  <td>{s.hours ?? <span className="muted">not known</span>}</td>
                  <td>{s.phone ?? "-"}</td>
                  <td>{s.contact ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
