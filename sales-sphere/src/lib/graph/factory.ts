import type { Mailbox } from "@prisma/client";
import { prisma } from "../db";
import type { CallLogger } from "../audit";
import { GraphClient } from "./client";
import { getAccessToken } from "./oauth";

export function graphFor(mailbox: Mailbox, logger: CallLogger): GraphClient {
  return new GraphClient({
    logger,
    mailbox: mailbox.email,
    // Re-read the row each time so a refreshed token is picked up.
    getAccessToken: async () => getAccessToken(await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } })),
  });
}

export const isConnected = (m: Pick<Mailbox, "encryptedRefreshToken">) => Boolean(m.encryptedRefreshToken);
