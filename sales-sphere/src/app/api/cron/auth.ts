import { env } from "@/lib/env";

export function cronAuthorized(req: Request) {
  const secret = env.cronSecret();
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}
