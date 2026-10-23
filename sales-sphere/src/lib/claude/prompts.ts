import { z } from "zod";
import type { Claude } from "./client";
import { COMPANY_CONTEXT, TRUTH_RULES } from "./client";
import type { ListTypeConfig } from "../listTypes/schema";
import { ListTypeConfigSchema } from "../listTypes/schema";

const listTypeBlock = (name: string, c: ListTypeConfig, verticalText?: string | null) =>
  `LIST TYPE: ${name}
${verticalText ? `VERTICAL (typed by user): ${verticalText}\n` : ""}Audience: ${c.audience === "partner" ? "Microsoft partners (peer collaboration)" : "end clients"}
Description: ${c.description}
Industries: ${c.industries.join(", ") || "any"}
Company size: ${c.sizeMin ?? "any"}-${c.sizeMax ?? "any"} staff
Signals: ${c.signals.join("; ")}
Search keywords: ${c.searchKeywords.join("; ") || "(work them out)"}
Use hiring signals: ${c.useHiringSignals ? "yes" : "no"}
Pitch: ${c.pitch}
Offer: ${c.offer}
Hot: ${c.hotCriteria}
Warm: ${c.warmCriteria}
Exclusions: ${c.exclusions.join("; ") || "none"}`;

// ---------- 1. Query planning ----------

const QueryPlan = z.object({
  queries: z.array(z.object({ q: z.string(), country: z.string().describe("ISO 3166 alpha-2 code, or empty") })),
});

export async function planSearchQueries(
  claude: Claude,
  p: { listName: string; config: ListTypeConfig; verticalText?: string | null; locations: { label: string; countryCode: string }[]; count: number; alreadyUsed: string[] },
) {
  const out = await claude.json(QueryPlan, {
    operation: "plan_queries",
    effort: "low",
    maxTokens: 4000,
    system: `${COMPANY_CONTEXT}\n\nYou plan web search queries that surface real companies matching a prospect list. Queries go to a general web search engine (Brave). Rules:
- Each query targets one location from the list.
- For hiring signals, search for job postings by role and city (e.g. "Dynamics 365 administrator" job Boston). Do not use site:linkedin.com.
- Prefer queries that return company websites, news about expansions, partner directories and job postings.
- Never repeat a query that was already used.`,
    prompt: `${listTypeBlock(p.listName, p.config, p.verticalText)}

LOCATIONS:
${p.locations.map((l) => `- ${l.label} [${l.countryCode}]`).join("\n")}

ALREADY USED:
${p.alreadyUsed.join("\n") || "(none)"}

Write ${p.count} new search queries.`,
  });
  return out.queries.slice(0, p.count);
}

// ---------- 2. Candidate extraction ----------

const Extracted = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      domain: z.string().nullable().describe("The company's own website domain if it appears in the results, else null. Never guess."),
      location: z.string().nullable(),
      signal: z.string().describe("The specific signal, quoted or paraphrased from the result"),
      evidence: z.array(z.number().int()).describe("Indexes of the results that show this"),
    }),
  ),
});

export async function extractCandidates(
  claude: Claude,
  p: { listName: string; config: ListTypeConfig; verticalText?: string | null; results: { title: string; url: string; snippet: string }[] },
) {
  return claude.json(Extracted, {
    operation: "extract_candidates",
    effort: "low",
    maxTokens: 8000,
    system: `${COMPANY_CONTEXT}\n\nYou read web search results and list the real companies they show that could fit the prospect list.\n${TRUTH_RULES}\n- Skip recruitment agencies, job boards, directories, news outlets, and Microsoft itself.\n- The hiring company in a job post is the prospect, not the job board.\n- Only set "domain" when the company's own site appears in a result URL or snippet.`,
    prompt: `${listTypeBlock(p.listName, p.config, p.verticalText)}

RESULTS:
${p.results.map((r, i) => `[${i}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n")}`,
  });
}

// ---------- 3. Scoring ----------

const Scores = z.object({
  scores: z.array(
    z.object({
      id: z.string(),
      score: z.number().int().describe("0-100 against the rubric"),
      tier: z.enum(["hot", "warm", "cold"]),
      why_now: z.string().describe("One line, based only on the evidence. If unsure, say so."),
      signal: z.string(),
      pitch: z.string().describe("The angle to pitch, one line"),
      confidence: z.enum(["high", "medium", "low"]),
      disqualify_reason: z.string().nullable().describe("Set if the company matches an exclusion or clearly does not fit"),
      industry: z.string().nullable(),
      size_label: z.string().nullable().describe("Only if evidence states size"),
    }),
  ),
});

export type ScoreInput = { id: string; name: string; domain: string; location?: string | null; evidence: { url: string; title?: string; snippet?: string }[]; pageText?: string | null };

export async function scoreCompanies(claude: Claude, p: { listName: string; config: ListTypeConfig; verticalText?: string | null; regionName: string; companies: ScoreInput[] }) {
  const out = await claude.json(Scores, {
    operation: "score_companies",
    effort: "medium",
    maxTokens: 12000,
    system: `${COMPANY_CONTEXT}\n\nYou qualify prospects for AdySphere. Score each company 0-100 against the list's rubric and tag it hot (75+), warm (50-74) or cold (<50).\n${TRUTH_RULES}\n- "why_now" must cite something specific in the evidence. If the evidence is thin, say "Unclear: ..." and lower confidence.`,
    prompt: `${listTypeBlock(p.listName, p.config, p.verticalText)}
REGION: ${p.regionName}

COMPANIES:
${p.companies
  .map(
    (c) => `--- id=${c.id}
Name: ${c.name}
Domain: ${c.domain}
Location: ${c.location ?? "unknown"}
Evidence:
${c.evidence.map((e) => `- ${e.title ?? ""} ${e.url}\n  ${e.snippet ?? ""}`).join("\n")}
Homepage extract: ${c.pageText ? c.pageText.slice(0, 1500) : "(not fetched)"}`,
  )
  .join("\n\n")}`,
  });
  return out.scores;
}

// ---------- 4. Email writing ----------

const Email = z.object({
  subject: z.string(),
  body: z.string().describe("Greeting line, then 3-4 short paragraphs separated by blank lines. No sign-off, no signature."),
});

export type WriterContext = {
  voiceGuide: string;
  proofPoints: { label: string; text: string }[];
  examples: { subject: string; before?: string | null; after: string }[];
  personaName: string;
  personaTone: string;
  spelling: string;
  currency: string;
};

function writerSystem(ctx: WriterContext) {
  const seeds = ctx.examples.filter((e) => !e.before);
  const edits = ctx.examples.filter((e) => e.before);
  return `${COMPANY_CONTEXT}

You write cold emails as ${ctx.personaName} (${ctx.personaTone}), in first person.
Spelling: ${ctx.spelling === "en-US" ? "US English" : "UK English"}. Currency: ${ctx.currency}.

VOICE GUIDE (follow every rule):
${ctx.voiceGuide}

PROOF POINTS (the only claims about AdySphere you may make):
${ctx.proofPoints.map((p) => `- ${p.label}: ${p.text}`).join("\n") || "- I'm a Microsoft AI Cloud Partner and I run D365 implementations myself."}

${TRUTH_RULES}

${seeds.length ? `EMAILS ${ctx.personaName.toUpperCase()} WROTE AND APPROVED (match this voice):\n${seeds.map((e) => `Subject: ${e.subject}\n${e.after}`).join("\n---\n")}\n` : ""}
${edits.length ? `EDITS SHE MADE TO YOUR EARLIER DRAFTS (learn what she changes):\n${edits.map((e) => `BEFORE:\n${e.before}\nAFTER:\n${e.after}`).join("\n---\n")}\n` : ""}`;
}

export async function writeEmail(
  claude: Claude,
  ctx: WriterContext,
  p: {
    listName: string;
    config: ListTypeConfig;
    company: { name: string; domain: string; location?: string | null };
    contact: { firstName?: string | null; name: string; title?: string | null };
    whyNow: string;
    signal: string;
    pitch: string;
    evidence: { url: string; title?: string; snippet?: string }[];
    note?: string | null;
    feedback?: string[];
  },
) {
  return claude.json(Email, {
    operation: "write_email",
    effort: "medium",
    maxTokens: 6000,
    system: writerSystem(ctx),
    prompt: `Write the first email.

Audience: ${p.config.audience === "partner" ? "a Microsoft partner. Talk as a peer offering capacity and AI skills." : "an end client. Talk about their outcomes."}
List: ${p.listName}. Pitch: ${p.pitch || p.config.pitch}. Offer: ${p.config.offer}.
List style notes: ${p.config.emailStyle}

To: ${p.contact.name}${p.contact.title ? `, ${p.contact.title}` : ""} at ${p.company.name} (${p.company.domain}${p.company.location ? `, ${p.company.location}` : ""})
Greeting: "Hi ${p.contact.firstName || p.contact.name.split(" ")[0]},"
Signal: ${p.signal}
Why now: ${p.whyNow}
Evidence:
${p.evidence.map((e) => `- ${e.title ?? ""} ${e.url}\n  ${e.snippet ?? ""}`).join("\n")}
${p.note ? `\nInstruction from ${ctx.personaName} for this rewrite: ${p.note}` : ""}
${p.feedback?.length ? `\nYour previous attempt broke these rules, fix them:\n- ${p.feedback.join("\n- ")}` : ""}`,
  });
}

export async function writeFollowUp(
  claude: Claude,
  ctx: WriterContext,
  p: { number: 1 | 2; company: { name: string }; contact: { firstName?: string | null; name: string }; previous: { subject: string; body: string }[]; signal: string; config: ListTypeConfig; feedback?: string[] },
) {
  const out = await claude.json(Email, {
    operation: "write_followup",
    effort: "medium",
    maxTokens: 4000,
    system: writerSystem(ctx),
    prompt: `Write follow-up #${p.number} in the same thread to ${p.contact.name} at ${p.company.name}. There has been no reply.
Rules: greeting line then 2-3 short lines. Add one new angle or a useful nugget (not a repeat), then a soft close like "happy to leave it here if timing's off". ${p.number === 2 ? "This is the last follow-up." : ""}
Original signal: ${p.signal}
Offer: ${p.config.offer}

Earlier emails in the thread:
${p.previous.map((m) => `Subject: ${m.subject}\n${m.body}`).join("\n---\n")}
${p.feedback?.length ? `\nYour previous attempt broke these rules, fix them:\n- ${p.feedback.join("\n- ")}` : ""}`,
  });
  return out.body;
}

// ---------- 5. New list type from plain English ----------

export async function draftListTypeConfig(claude: Claude, description: string) {
  const Draft = z.object({ name: z.string(), config: ListTypeConfigSchema });
  return claude.json(Draft, {
    operation: "draft_list_type",
    effort: "medium",
    maxTokens: 6000,
    system: `${COMPANY_CONTEXT}\n\nYou turn a plain-English description of a prospect list into a structured list configuration for AdySphere's lead-generation agent. Be specific and practical: realistic search keywords, decision-maker titles in priority order (owner/CEO/COO/CFO for SMEs; CIO/IT director/head of business apps for enterprises; practice lead for partners), clear hot vs warm criteria. Leave proofPointLabels empty.`,
    prompt: description,
  });
}

// ---------- 6. Reply classification ----------

const ReplyClass = z.object({
  status: z.enum(["replied", "out_of_office", "bounced", "not_interested"]),
  summary: z.string().describe("One line summary of the reply"),
  meeting_requested: z.boolean().describe("True if they agreed to or proposed a call/meeting"),
});

export async function classifyReply(claude: Claude, p: { from: string; subject: string; text: string }) {
  return claude.json(ReplyClass, {
    operation: "classify_reply",
    effort: "low",
    maxTokens: 2000,
    system: `You classify replies to B2B outreach emails. "replied" = a human replied with interest, a question or anything other than a clear no. "not_interested" = a clear no, unsubscribe or "remove me". "out_of_office" = an automatic away message. "bounced" = a delivery failure notice.`,
    prompt: `From: ${p.from}\nSubject: ${p.subject}\n\n${p.text.slice(0, 4000)}`,
  });
}
