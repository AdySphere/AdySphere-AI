import { NextResponse } from "next/server";
import { runFollowUps } from "@/lib/replies/followups";
import { syncAllReplies } from "@/lib/replies/sync";
import { cronAuthorized } from "../auth";

export const maxDuration = 300;

// Schedule once a day on weekdays. Syncs replies first so nobody who replied gets a follow-up.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await syncAllReplies();
  return NextResponse.json({ created: await runFollowUps() });
}
