import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verify } from "@/lib/crypto";
import { env } from "@/lib/env";
import { exchangeCode, storeTokens } from "@/lib/graph/oauth";
import { GraphClient } from "@/lib/graph/client";
import { dbCallLogger } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const back = (msg: string) => NextResponse.redirect(`${env.appUrl()}/settings/mailboxes?msg=${encodeURIComponent(msg)}`);
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return back(`Microsoft sign-in failed: ${p.get("error_description") ?? p.get("error")}`);
  let state: { mailboxId: string; nonce: string; send: boolean };
  try {
    state = verify(p.get("state") ?? "");
  } catch (e) {
    return back(`Sign-in rejected: ${(e as Error).message}`);
  }
  if (req.cookies.get("ms_oauth_nonce")?.value !== state.nonce) return back("Sign-in rejected: session mismatch, try again");

  const tokens = await exchangeCode(p.get("code") ?? "", state.send);
  const me = await new GraphClient({ getAccessToken: async () => tokens.access_token, logger: dbCallLogger }).me();
  const signedIn = (me.mail ?? me.userPrincipalName).toLowerCase();
  const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: state.mailboxId } });
  // The draft must land in the right mailbox: refuse a different account.
  if (signedIn !== mailbox.email.toLowerCase()) return back(`You signed in as ${signedIn}, but this mailbox is ${mailbox.email}. Sign in with the right account.`);

  await storeTokens(mailbox.id, tokens);
  await prisma.mailbox.update({ where: { id: mailbox.id }, data: { graphUserId: me.id, connectedAt: new Date() } });
  const res = back(`Connected ${mailbox.email}`);
  res.cookies.delete("ms_oauth_nonce");
  return res;
}
