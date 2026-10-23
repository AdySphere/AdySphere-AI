import { PrismaClient, type Prisma } from "@prisma/client";
import { DEFAULT_LIST_TYPES } from "../src/lib/listTypes/defaults";
import { complianceFor, type RegionLocation } from "../src/lib/geo/regions";

const prisma = new PrismaClient();

const loc = (label: string, lat: number, lon: number, countryCode: string, kind: RegionLocation["kind"] = "city"): RegionLocation => ({
  label, query: label.split(",")[0]!, kind, lat, lon, countryCode, city: label.split(",")[0],
});

// Examples only: any region can be added in Settings → Regions.
const REGIONS = [
  {
    name: "UAE", timeZone: "Asia/Dubai", currency: "AED", spelling: "en-GB",
    locations: [loc("Dubai, United Arab Emirates", 25.2048, 55.2708, "AE"), loc("Abu Dhabi, United Arab Emirates", 24.4539, 54.3773, "AE"), loc("Sharjah, United Arab Emirates", 25.3463, 55.4209, "AE")],
  },
  {
    name: "UK", timeZone: "Europe/London", currency: "GBP", spelling: "en-GB",
    locations: [loc("London, England, United Kingdom", 51.5072, -0.1276, "GB"), loc("Manchester, England, United Kingdom", 53.4808, -2.2426, "GB"), loc("Cardiff, Wales, United Kingdom", 51.4816, -3.1791, "GB")],
  },
  {
    name: "US-Boston", timeZone: "America/New_York", currency: "USD", spelling: "en-US",
    locations: [loc("Boston, Massachusetts, United States", 42.3601, -71.0589, "US"), loc("Cambridge, Massachusetts, United States", 42.3736, -71.1097, "US"), loc("Waltham, Massachusetts, United States", 42.3765, -71.2356, "US"), loc("Quincy, Massachusetts, United States", 42.2529, -71.0023, "US")],
  },
];

async function main() {
  const mallicka = await prisma.mailbox.upsert({
    where: { email: "mallicka@adysphere.com" },
    create: { email: "mallicka@adysphere.com", displayName: "Adyasha Mallick", personaName: "Adyasha", signOff: "Best," },
    update: {},
  });
  await prisma.mailbox.upsert({
    where: { email: "uzair@adysphere.com" },
    create: { email: "uzair@adysphere.com", displayName: "Uzair", personaName: "Uzair", signOff: "Best,", personaTone: "consultant at AdySphere, peer to peer, confident and direct" },
    update: {},
  });

  for (const r of REGIONS) {
    const { note, footer } = complianceFor(r.locations.map((l) => l.countryCode));
    await prisma.region.upsert({
      where: { name: r.name },
      create: { ...r, locations: r.locations as unknown as Prisma.InputJsonValue, complianceNote: note, complianceFooter: footer, defaultMailboxId: mallicka.id },
      update: {},
    });
  }

  for (const lt of DEFAULT_LIST_TYPES) {
    await prisma.listType.upsert({ where: { slug: lt.slug }, create: { slug: lt.slug, name: lt.name, config: lt.config as Prisma.InputJsonValue }, update: {} });
  }

  if ((await prisma.proofPoint.count()) === 0) {
    await prisma.proofPoint.create({ data: { label: "Microsoft partner", text: "I'm a Microsoft AI Cloud Partner and I run D365 implementations myself." } });
  }

  await prisma.exclusion.upsert({
    where: { kind_value: { kind: "company", value: "business experts mea" } },
    create: { kind: "company", value: "business experts mea", reason: "blocked", note: "Blocked by Adyasha" },
    update: {},
  });
  console.log("Seeded mailboxes, regions, list types, proof points and exclusions.");
}

main().finally(() => prisma.$disconnect());
