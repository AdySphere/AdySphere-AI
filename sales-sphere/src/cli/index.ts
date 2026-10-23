#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { prisma } from "../lib/db";
import { confirmCampaign, runCampaign, skipEnrichment } from "../lib/pipeline/run";
import { syncAllReplies } from "../lib/replies/sync";
import { runFollowUps } from "../lib/replies/followups";
import { buildWorkbook, campaignRows } from "../lib/export/excel";
import { pushPendingDrafts } from "../lib/drafts/service";

const program = new Command().name("sales-sphere").description("AdySphere lead-gen agent (batch runs)");

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

async function printNewLogs(campaignId: string, since: Date) {
  const logs = await prisma.campaignLog.findMany({ where: { campaignId, createdAt: { gt: since } }, orderBy: { createdAt: "asc" } });
  for (const l of logs) console.log(`${l.level === "info" ? " " : l.level === "warn" ? "!" : "x"} ${l.message}`);
  return logs.at(-1)?.createdAt ?? since;
}

program
  .command("run")
  .description('Run a campaign, e.g. run --region US-Boston --list warm-hiring --count 50')
  .requiredOption("-r, --region <name>", "region name")
  .requiredOption("-l, --list <slug>", "list type slug")
  .option("-c, --count <n>", "target number of prospects", "25")
  .option("-v, --vertical <text>", 'vertical for the "vertical" list type')
  .option("-m, --mailbox <email>", "mailbox to write from (defaults to the region's)")
  .option("-y, --yes", "confirm cost prompts automatically (only use when you've checked the estimate)")
  .action(async (o) => {
    const region = await prisma.region.findFirstOrThrow({ where: { name: { equals: o.region, mode: "insensitive" } } });
    const listType = await prisma.listType.findUniqueOrThrow({ where: { slug: o.list } });
    if (listType.status === "paused") throw new Error(`List type ${o.list} is paused`);
    const mailbox = o.mailbox ? await prisma.mailbox.findUniqueOrThrow({ where: { email: o.mailbox } }) : null;
    const c = await prisma.campaign.create({ data: { regionId: region.id, listTypeId: listType.id, targetCount: Number(o.count), verticalText: o.vertical ?? null, mailboxId: mailbox?.id } });
    console.log(`Campaign ${c.id}`);
    let since = new Date(0);
    for (;;) {
      await runCampaign(c.id);
      since = await printNewLogs(c.id, since);
      const cur = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
      if (cur.status === "awaiting_run_confirmation") {
        if (!(o.yes || (await ask("Proceed with this spend?")))) return console.log("Stopped. Resume later with: confirm", c.id);
        await confirmCampaign(c.id, "run");
      } else if (cur.status === "awaiting_enrich_confirmation") {
        if (o.yes || (await ask(`Spend up to ${cur.estimatedCredits} Apollo credits on email enrichment?`))) await confirmCampaign(c.id, "enrich");
        else await skipEnrichment(c.id);
      } else break;
    }
    const done = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    console.log(`Status: ${done.status}. Apollo credits used: ${done.creditsUsed}.`);
  });

program
  .command("confirm <campaignId>")
  .description("Confirm a pending cost prompt and continue the campaign")
  .action(async (id) => {
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    await confirmCampaign(id, c.status === "awaiting_enrich_confirmation" ? "enrich" : "run");
    await runCampaign(id);
    await printNewLogs(id, c.updatedAt);
  });

program
  .command("replies")
  .description("Check every connected mailbox for replies, bounces and out-of-office")
  .action(async () => console.log(JSON.stringify(await syncAllReplies(), null, 2)));

program
  .command("followups")
  .description("Draft follow-ups for prospects with no reply after N business days")
  .action(async () => console.log((await runFollowUps()).join("\n") || "No follow-ups due."));

program
  .command("push <mailboxEmail>")
  .description("Push review-queue drafts to Outlook (stops at the daily cap)")
  .action(async (email) => {
    const m = await prisma.mailbox.findUniqueOrThrow({ where: { email } });
    console.log(await pushPendingDrafts(m.id));
  });

program
  .command("export <campaignId>")
  .description("Write the campaign's Excel export to ./exports")
  .action(async (id) => {
    await mkdir("exports", { recursive: true });
    const path = `exports/campaign-${id}.xlsx`;
    await writeFile(path, await buildWorkbook(await campaignRows(id)));
    console.log(path);
  });

program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
