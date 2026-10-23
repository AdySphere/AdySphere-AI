import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { SettingsNav } from "./nav";

export const dynamic = "force-dynamic";

const Status = ({ ok, label, hint }: { ok: boolean; label: string; hint: string }) => (
  <tr><td>{label}</td><td>{ok ? <span className="ok">set</span> : <span className="err">missing</span>}</td><td className="muted">{hint}</td></tr>
);

export default async function SettingsHome() {
  const [mailboxes, calls] = await Promise.all([
    prisma.mailbox.count({ where: { encryptedRefreshToken: { not: null } } }),
    prisma.externalCall.groupBy({ by: ["provider", "costUnit"], _sum: { cost: true }, _count: true }),
  ]);
  return (
    <>
      <h1>Settings</h1>
      <SettingsNav />
      <h2>API keys</h2>
      <table>
        <tbody>
          <Status ok={env.hasAnthropic()} label="Anthropic (Claude)" hint={`ANTHROPIC_API_KEY · model ${env.anthropicModel()} · effort ${env.anthropicEffort()}`} />
          <Status ok={env.hasMicrosoft()} label="Microsoft Graph" hint={`MS_CLIENT_ID / MS_CLIENT_SECRET · ${mailboxes} mailbox(es) connected`} />
          <Status ok={env.hasApollo()} label="Apollo.io" hint={`APOLLO_API_KEY · org search ${env.apolloOrgSearchEnabled() ? "on" : "off"}`} />
          <Status ok={env.searchProvider() === "none" || env.hasBrave()} label="Web search" hint={`SEARCH_PROVIDER=${env.searchProvider()} · BRAVE_API_KEY`} />
          <Status ok={Boolean(process.env.TOKEN_ENCRYPTION_KEY)} label="Token encryption" hint="TOKEN_ENCRYPTION_KEY (32 bytes, base64)" />
          <Status ok={Boolean(process.env.APP_PASSWORD)} label="App password" hint="APP_PASSWORD protects this UI" />
          <Status ok={Boolean(process.env.CRON_SECRET)} label="Cron secret" hint="CRON_SECRET for reply tracking / follow-up schedules" />
        </tbody>
      </table>
      <h2>External calls (all time)</h2>
      <table>
        <thead><tr><th>Provider</th><th>Calls</th><th>Cost</th></tr></thead>
        <tbody>
          {calls.map((c) => (
            <tr key={`${c.provider}-${c.costUnit}`}><td>{c.provider}</td><td>{c._count}</td><td>{c.costUnit === "usd" ? `$${(c._sum.cost ?? 0).toFixed(2)}` : c.costUnit === "credits" ? `${c._sum.cost ?? 0} credits` : "-"}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
