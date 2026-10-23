import { z } from "zod";

export const ListTypeConfigSchema = z.object({
  description: z.string().describe("One or two sentences on what this list is for"),
  audience: z.enum(["end_client", "partner"]).describe("partner = Microsoft partners we subcontract for; end_client = companies we sell to directly"),
  industries: z.array(z.string()).describe("Target industries"),
  sizeMin: z.number().int().nullable().describe("Minimum staff count, or null"),
  sizeMax: z.number().int().nullable().describe("Maximum staff count, or null"),
  signals: z.array(z.string()).describe("Buying signals to look for in evidence"),
  searchKeywords: z.array(z.string()).describe("Keywords and phrases for web search queries"),
  useHiringSignals: z.boolean().describe("Search job postings for hiring signals"),
  titles: z.array(z.string()).describe("Decision-maker titles to contact, in priority order"),
  pitch: z.string().describe("What we pitch"),
  offer: z.string().describe("The concrete offer or next step, e.g. the Business X-Ray"),
  proofPointLabels: z.array(z.string()).describe("Labels of proof points to use; empty means all active proof points"),
  hotCriteria: z.string().describe("What makes a lead Hot"),
  warmCriteria: z.string().describe("What makes a lead Warm"),
  exclusions: z.array(z.string()).describe("Companies, domains or kinds of company to exclude"),
  emailStyle: z.string().describe("Extra style notes for this list on top of the voice guide"),
  needsVerticalText: z.boolean().describe("True when each campaign must supply a free-text vertical"),
});

export type ListTypeConfig = z.infer<typeof ListTypeConfigSchema>;

export function parseListTypeConfig(value: unknown): ListTypeConfig {
  return ListTypeConfigSchema.parse(value);
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "list";
}
