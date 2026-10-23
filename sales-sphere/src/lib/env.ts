// Read env vars lazily so `next build` works without secrets present.
function read(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

export const env = {
  appUrl: () => read("APP_URL", "http://localhost:3000").replace(/\/$/, ""),
  appPassword: () => process.env.APP_PASSWORD ?? "",
  cronSecret: () => process.env.CRON_SECRET ?? "",
  encryptionKey: () => read("TOKEN_ENCRYPTION_KEY"),

  anthropicModel: () => read("ANTHROPIC_MODEL", "claude-opus-5-5"),
  anthropicEffort: () => read("ANTHROPIC_EFFORT", "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  anthropicInputUsdPerMTok: () => Number(read("ANTHROPIC_INPUT_USD_PER_MTOK", "4")),
  anthropicOutputUsdPerMTok: () => Number(read("ANTHROPIC_OUTPUT_USD_PER_MTOK", "20")),
  hasAnthropic: () => Boolean(process.env.ANTHROPIC_API_KEY),

  msClientId: () => read("MS_CLIENT_ID"),
  msClientSecret: () => read("MS_CLIENT_SECRET"),
  msTenantId: () => read("MS_TENANT_ID", "organizations"),
  hasMicrosoft: () => Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET),

  apolloApiKey: () => read("APOLLO_API_KEY"),
  apolloOrgSearchEnabled: () => process.env.APOLLO_ORG_SEARCH_ENABLED === "true",
  hasApollo: () => Boolean(process.env.APOLLO_API_KEY),

  searchProvider: () => read("SEARCH_PROVIDER", "brave") as "brave" | "none",
  braveApiKey: () => read("BRAVE_API_KEY"),
  hasBrave: () => Boolean(process.env.BRAVE_API_KEY),

  nominatimBaseUrl: () => read("NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org").replace(/\/$/, ""),
  nominatimContact: () => read("NOMINATIM_CONTACT_EMAIL", "mallicka@adysphere.com"),
};
