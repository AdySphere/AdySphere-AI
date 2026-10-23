import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { sign } from "@/lib/crypto";
import { authorizeUrl } from "@/lib/graph/oauth";

// /api/auth/microsoft/start?mailboxId=...  (Mail.Send is requested only if the mailbox has "allow send" on)
export async function GET(req: NextRequest) {
  const mailboxId = req.nextUrl.searchParams.get("mailboxId");
  if (!mailboxId) return NextResponse.json({ error: "mailboxId required" }, { status: 400 });
  const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
  const nonce = randomBytes(16).toString("base64url");
  const state = sign({ mailboxId, nonce, send: mailbox.allowSend });
  const res = NextResponse.redirect(authorizeUrl(state, mailbox.allowSend, mailbox.email));
  res.cookies.set("ms_oauth_nonce", nonce, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/auth/microsoft" });
  return res;
}
