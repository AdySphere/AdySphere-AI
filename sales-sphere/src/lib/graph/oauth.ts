import type { Mailbox } from "@prisma/client";
import { prisma } from "../db";
import { decrypt, encrypt } from "../crypto";
import { env } from "../env";
import type { FetchLike } from "../audit";

export const BASE_SCOPES = ["offline_access", "User.Read", "Mail.ReadWrite"];
export const SEND_SCOPE = "Mail.Send";

export function redirectUri() {
  return `${env.appUrl()}/api/auth/microsoft/callback`;
}

function authority() {
  return `https://login.microsoftonline.com/${env.msTenantId()}/oauth2/v2.0`;
}

export function scopesFor(includeSend: boolean) {
  return includeSend ? [...BASE_SCOPES, SEND_SCOPE] : BASE_SCOPES;
}

export function authorizeUrl(state: string, includeSend: boolean, loginHint?: string) {
  const params = new URLSearchParams({
    client_id: env.msClientId(),
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: scopesFor(includeSend).join(" "),
    state,
    prompt: "select_account",
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `${authority()}/authorize?${params}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope: string };

async function tokenRequest(body: Record<string, string>, f: FetchLike = fetch): Promise<TokenResponse> {
  const res = await f(`${authority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.msClientId(), client_secret: env.msClientSecret(), ...body }).toString(),
  });
  if (!res.ok) throw new Error(`Microsoft token request failed: ${res.status} ${await res.text()}`.slice(0, 500));
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(code: string, includeSend: boolean) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), scope: scopesFor(includeSend).join(" ") });
}

export async function storeTokens(mailboxId: string, t: TokenResponse) {
  await prisma.mailbox.update({
    where: { id: mailboxId },
    data: {
      accessToken: encrypt(t.access_token),
      accessTokenExpiresAt: new Date(Date.now() + (t.expires_in - 120) * 1000),
      ...(t.refresh_token ? { encryptedRefreshToken: encrypt(t.refresh_token) } : {}),
    },
  });
}

/** Returns a valid access token, refreshing (and rotating the refresh token) when needed. */
export async function getAccessToken(mailbox: Mailbox): Promise<string> {
  if (mailbox.accessToken && mailbox.accessTokenExpiresAt && mailbox.accessTokenExpiresAt > new Date()) {
    return decrypt(mailbox.accessToken);
  }
  if (!mailbox.encryptedRefreshToken) throw new Error(`Mailbox ${mailbox.email} is not connected`);
  const t = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: decrypt(mailbox.encryptedRefreshToken),
    scope: scopesFor(mailbox.allowSend).join(" "),
  });
  await storeTokens(mailbox.id, t);
  return t.access_token;
}
