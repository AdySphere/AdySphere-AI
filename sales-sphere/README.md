# Sales Sphere: AdySphere lead-gen agent

Finds prospects by region and list type, finds one decision-maker per company, writes a personalised email in Adyasha's voice, and saves it as a **draft** in the right Outlook mailbox. Nothing is sent unless a mailbox has "allow send" switched on **and** you approve the batch.

Stack: TypeScript, Node 20+, Next.js 15 (App Router) + a CLI, Postgres via Prisma, Claude (Anthropic API), Microsoft Graph, Apollo.io, Brave Search, Nominatim (OpenStreetMap).

## What it does

| Step | Where |
|---|---|
| 1. Find companies: Claude plans searches → Brave (incl. job-post searches) → Claude extracts companies that the results actually show; optional Apollo org search | `src/lib/pipeline/run.ts`, `src/lib/claude/prompts.ts` |
| 2. Score 0–100, Hot / Warm / Cold, one-line "why now" from evidence only; every lead keeps its source URLs | `scoreCompanies` |
| 3. Dedupe by domain against everything in the database (all campaigns, all mailboxes); a company can belong to only one campaign, ever | `src/lib/pipeline/dedupe.ts`, `Prospect.companyId @unique` |
| 4. Do-not-contact list: blocked companies/domains, clients, "not interested" replies, review rejects, plus named exclusions on the list type | `src/lib/pipeline/exclusions.ts` |
| 5. One decision-maker per company with Apollo people search (free), title priority from the list type | `src/lib/apollo/client.ts` |
| 6. Email enrichment (credits): shows the estimate and **waits for your confirmation**; never spends past what you confirmed; unverified → "LinkedIn/phone only" | `src/lib/apollo/credits.ts` |
| 7. Email in the region's spelling, checked against the voice rules (80–130 words, no buzzwords, no "!", no emojis), rewritten if it breaks them | `src/lib/drafts/writer.ts`, `src/lib/voice.ts` |
| 8. Outlook draft via `POST /me/messages` in the region's mailbox, with sign-off, HTML signature (images stripped) and the region's compliance footer; deferred-send time set to the prospect's next business-day morning | `src/lib/drafts/outlook.ts` |
| 9. Follow-ups after N business days (default 4), max 2, as replies in the same thread | `src/lib/replies/followups.ts` |
| Reply tracking: replied / out of office / bounced / not interested, with a one-line summary | `src/lib/replies/sync.ts` |
| Excel export (colour-coded, frozen header), field-visit route sheet, dashboard | `src/lib/export/*`, `src/lib/stats.ts` |

Guardrails: drafts only by default; hard daily cap per mailbox (default 50); a run whose estimated spend is over your budget (default $5) waits for confirmation; every external call is logged (`ExternalCall` table: provider, cost, time); robots.txt respected; LinkedIn is never fetched or cited; Claude may only use facts from the evidence and claims from **Proof points**; US drafts are blocked until a physical address is set (CAN-SPAM).

## Setup

```bash
cd sales-sphere
npm ci
cp .env.example .env        # fill in values, see below
npx prisma migrate deploy   # creates the tables
npm run db:seed             # mailboxes, UAE/UK/US-Boston regions, the 5 list types, a proof point, Business Experts MEA exclusion
npm run dev                 # http://localhost:3000
```

### Environment variables

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres (Supabase or Railway Postgres both work) |
| `APP_URL` | Public URL, used for the Microsoft redirect URI |
| `APP_PASSWORD` | Password for the web UI (HTTP basic auth, any username). Required in production |
| `TOKEN_ENCRYPTION_KEY` | 32 bytes base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Encrypts refresh tokens (AES-256-GCM). Don't lose it: you'd have to reconnect mailboxes |
| `CRON_SECRET` | Bearer token for `/api/cron/*` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `ANTHROPIC_EFFORT` | Model name lives in config only |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID` | Entra ID app (below) |
| `APOLLO_API_KEY`, `APOLLO_ORG_SEARCH_ENABLED` | Org search only if your plan includes it via API |
| `SEARCH_PROVIDER` (`brave` / `none`), `BRAVE_API_KEY` | |
| `NOMINATIM_CONTACT_EMAIL` | Nominatim's policy needs a real contact address |

### Register the Entra ID app (Microsoft Graph)

1. [Entra admin centre](https://entra.microsoft.com) → **App registrations** → **New registration**.
   - Name: `Sales Sphere`. Supported account types: *Accounts in this organizational directory only* (or *any organizational directory* if team mailboxes are in other tenants).
   - Redirect URI: platform **Web**, `https://<your-app>/api/auth/microsoft/callback` (and `http://localhost:3000/api/auth/microsoft/callback` for local dev).
2. **Certificates & secrets** → **New client secret** → copy the value into `MS_CLIENT_SECRET`. Copy the **Application (client) ID** into `MS_CLIENT_ID`. Put the **Directory (tenant) ID** in `MS_TENANT_ID` (or leave `organizations`).
3. **API permissions** → **Add** → Microsoft Graph → **Delegated**: `User.Read`, `Mail.ReadWrite`, `offline_access`, and `Mail.Send` only if you'll ever switch sending on. Click **Grant admin consent** if your tenant requires it.
4. In the app: **Settings → Mailboxes** → **Connect with Microsoft** for each mailbox and sign in *as that mailbox*. The app refuses a sign-in that doesn't match the mailbox's address, so drafts can't land in the wrong place. Each person connects their own mailbox (delegated access), so nobody needs admin-wide mail access.

Turning on **Allow send** for a mailbox requires reconnecting it so `Mail.Send` is granted. Sending still only happens from the review queue, per batch, after typing `SEND`.

### Scheduled jobs

Point your scheduler at these with header `Authorization: Bearer $CRON_SECRET`:

| Endpoint | Suggested schedule |
|---|---|
| `GET /api/cron/replies` | every 3 hours: `0 */3 * * *` |
| `GET /api/cron/followups` | weekdays once: `0 6 * * 1-5` (syncs replies first) |

On Railway, add a cron service that runs `curl -fsS -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/replies`. On Vercel, use `vercel.json` crons (Vercel sends `CRON_SECRET` as the bearer token automatically).

### Deploying

**Railway is recommended**: a campaign of 50 runs for several minutes, which a long-lived Node server handles fine. `railway.json` builds the app and runs migrations on start. Vercel works for the UI, but serverless time limits can cut long campaigns short; run big batches with the CLI instead.

## Using it

- **Campaigns**: pick region, list type and count → **Run**. The page shows a live log. You'll be asked to confirm if the estimate is over budget, and always before Apollo enrichment spends credits.
- **Review queue**: edit, approve, reject (deletes the Outlook draft and adds the company to the do-not-contact list) or regenerate with a note. Edits sync to the Outlook draft. When you approve an edited draft, the before/after pair is saved and used as a few-shot example next time.
- **Settings**: mailboxes (connect/disconnect, signature, persona, daily cap, allow send), regions (type any place: "Riyadh", "Germany", "within 30 km of Manchester", "Texas + Oklahoma"; time zone, currency, spelling and compliance footer are filled in from the place), list types (create, describe in plain English for Claude to draft, duplicate, edit, pause, delete), proof points, exclusions, voice guide + seed examples, general (budgets, send time, follow-up timing, physical address), API key status.

### CLI

```bash
npm run cli -- run --region US-Boston --list warm-hiring --count 50
npm run cli -- run --region UAE --list vertical --vertical "food distributors" --count 20
npm run cli -- confirm <campaignId>        # continue after a cost prompt
npm run cli -- replies                     # reply tracking now
npm run cli -- followups                   # draft due follow-ups
npm run cli -- push mallicka@adysphere.com # push review-queue drafts to Outlook (stops at the daily cap)
npm run cli -- export <campaignId>         # ./exports/campaign-<id>.xlsx
```

The CLI asks before spending (`--yes` skips the prompts; only use it once you've checked the estimate).

## Tests

```bash
npm test
```

Unit tests cover dedupe, exclusions, credit tracking, draft creation (mocked Graph and Apollo), scheduling, follow-up timing, voice rules, encryption, region parsing, reply detection and the Excel export. The end-to-end pipeline test runs only when `TEST_DATABASE_URL` is set, and **wipes that database**, so give it its own:

```bash
createdb salessphere_test
DATABASE_URL=postgresql://.../salessphere_test npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://.../salessphere_test npm test
```

## Costs (paid services, your choice)

Nothing paid is enabled until you add a key.

- **Claude**: per token; the pre-run estimate assumes about $0.06 per prospect. Every call's cost is logged.
- **Brave Search**: free tier, then paid per query (set your rate in Settings → General).
- **Apollo**: people search is free; email enrichment costs 1 credit per contact and always asks first; org search (if enabled) counts 1 credit per page.
- **Nominatim** is free (max 1 request/second, enforced).
- **Hosting/DB**: Railway or Supabase plans are your call.

## Notes and limits

- Deferred delivery: drafts carry `PidTagDeferredSendTime`, so when they're sent (by you in Outlook or by an approved batch) Exchange holds them until the prospect's local morning.
- Company addresses, phones and opening hours come from Apollo where available. Hours are often unknown, and the field-visit sheet says so rather than guessing.
- Job-board and LinkedIn pages are never fetched: only search-result snippets and the company's own site (robots.txt respected) are used as evidence.
