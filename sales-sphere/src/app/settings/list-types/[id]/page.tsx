import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseListTypeConfig } from "@/lib/listTypes/schema";
import { toggleListType } from "../../../actions";
import { SettingsNav } from "../../nav";
import { ListTypeForm } from "../ListTypeForm";

export const dynamic = "force-dynamic";

export default async function EditListType({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ drafted?: string }> }) {
  const { id } = await params;
  const { drafted } = await searchParams;
  const lt = await prisma.listType.findUnique({ where: { id } });
  if (!lt) notFound();
  return (
    <>
      <h1>{lt.name} <span className="pill">{lt.status}</span></h1>
      <SettingsNav />
      {drafted && (
        <div className="notice">
          Claude drafted this list. Review it, save, then activate it.
          <form action={toggleListType.bind(null, lt.id)} style={{ display: "inline", marginLeft: 8 }}><button className="secondary">{lt.status === "active" ? "Pause" : "Activate"}</button></form>
        </div>
      )}
      <ListTypeForm id={lt.id} name={lt.name} config={parseListTypeConfig(lt.config)} />
    </>
  );
}
