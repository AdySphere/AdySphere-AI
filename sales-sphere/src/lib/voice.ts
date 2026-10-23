// Editable in Settings → Voice. This is only the default.
export const DEFAULT_VOICE_GUIDE = `The voice is Adyasha + salesperson: a founder who actually builds the systems, writing peer to peer, confident and direct, never needy.

- Open with them, not us. Start with one specific, true observation: a job they're hiring for, a recent expansion, a gap on their site, their industry's pain. No "I hope this email finds you well" and no "My name is...".
- Connect it to a real problem in their words. For example: "Hiring a D365 admin usually means the backlog is already piling up."
- One line of credibility, in first person: "I'm a Microsoft AI Cloud Partner and I run D365 implementations myself." Use only proof points from config.
- One clear, low-friction ask: a 15-minute call, or "worth a quick chat next week?". Offer a concrete next step such as the Business X-Ray where it fits.
- Short: 80-130 words, 3-4 short paragraphs, plain English. No buzzwords ("leverage", "synergy", "cutting-edge", "transform"), no exclamation marks, no emojis, no AI-sounding phrasing.
- Subject line: short, lowercase-friendly and specific, e.g. "your d365 admin role" or "quick idea for [company]". Never clickbait.
- Sign-off is added automatically ("Best, <name>" plus the mailbox signature). Do not write a sign-off or signature.
- Follow-ups: 2-3 lines, same thread, add one new angle or a useful nugget, then a soft close ("happy to leave it here if timing's off").
- Partners vs end clients: to partners, talk as a peer offering capacity and AI skills ("extra hands on your D365 projects"). To end clients, talk about their outcomes.`;

export const BANNED_PHRASES = [
  "leverage", "synergy", "synergies", "cutting-edge", "cutting edge", "transform", "transformation",
  "revolutionize", "revolutionise", "game-changer", "game changer", "unlock", "empower", "seamless",
  "i hope this email finds you well", "i hope you are well", "i hope you're well", "my name is",
  "delve", "in today's fast-paced", "best-in-class", "world-class",
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Returns a list of problems; empty means the email follows the hard rules.
export function checkVoiceRules(
  email: { subject: string; body: string },
  opts: { minWords: number; maxWords: number },
): string[] {
  const problems: string[] = [];
  const all = `${email.subject}\n${email.body}`;
  const lower = all.toLowerCase();
  const words = wordCount(email.body);
  if (words < opts.minWords || words > opts.maxWords) {
    problems.push(`Body is ${words} words; it must be ${opts.minWords}-${opts.maxWords}.`);
  }
  if (all.includes("!")) problems.push("Remove every exclamation mark.");
  if (EMOJI.test(all)) problems.push("Remove emojis.");
  for (const p of BANNED_PHRASES) {
    if (new RegExp(`\\b${p.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`, "i").test(lower)) {
      problems.push(`Do not use "${p}".`);
    }
  }
  if (email.subject.length > 60) problems.push("Subject must be under 60 characters.");
  return problems;
}

// Light US→UK / UK→US spelling pass for words Claude sometimes slips on.
const UK_US: [string, string][] = [
  ["optimise", "optimize"], ["organisation", "organization"], ["organise", "organize"], ["analyse", "analyze"],
  ["prioritise", "prioritize"], ["centre", "center"], ["colour", "color"], ["favour", "favor"],
  ["licence", "license"], ["programme", "program"], ["realise", "realize"], ["specialise", "specialize"],
  ["standardise", "standardize"], ["modernise", "modernize"], ["customise", "customize"], ["catalogue", "catalog"],
];

export function applySpelling(text: string, spelling: string): string {
  const toUs = spelling === "en-US";
  let out = text;
  for (const [uk, us] of UK_US) {
    const [from, to] = toUs ? [uk, us] : [us, uk];
    out = out.replace(new RegExp(`\\b${from}(s|d|r|rs|ing|ation|ations)?\\b`, "gi"), (m, suffix = "") => {
      const repl = to + suffix;
      return m[0] === m[0]!.toUpperCase() ? repl[0]!.toUpperCase() + repl.slice(1) : repl;
    });
  }
  return out;
}
