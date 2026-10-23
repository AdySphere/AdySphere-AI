import { NextResponse } from "next/server";
import { syncAllReplies } from "@/lib/replies/sync";
import { cronAuthorized } from "../auth";

export const maxDuration = 300;

// Schedule every few hours, e.g. "0 */3 * * *".
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await syncAllReplies());
}
