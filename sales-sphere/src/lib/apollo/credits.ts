// Apollo enrichment costs credits. Nothing is spent beyond what the user confirmed.

export interface CreditStore {
  add(campaignId: string, credits: number, operation: string, meta?: Record<string, unknown>): Promise<void>;
}

export class CreditLimitError extends Error {
  constructor(public needed: number, public remaining: number) {
    super(`Apollo credit limit reached: needs ${needed}, ${remaining} confirmed credits remaining`);
  }
}

export class CreditTracker {
  private used = 0;

  constructor(
    private store: CreditStore,
    private campaignId: string,
    private approved: number,
  ) {}

  get creditsUsed() {
    return this.used;
  }

  get remaining() {
    return Math.max(0, this.approved - this.used);
  }

  /** Throws before the paid call if it would exceed the confirmed budget. */
  ensure(credits: number) {
    if (this.used + credits > this.approved) throw new CreditLimitError(credits, this.remaining);
  }

  async record(credits: number, operation: string, meta?: Record<string, unknown>) {
    if (credits <= 0) return;
    this.used += credits;
    await this.store.add(this.campaignId, credits, operation, meta);
  }

  /** Wraps a paid call: checks the budget first, records actual credits after. */
  async spend<T>(estimate: number, operation: string, fn: () => Promise<{ result: T; credits: number }>, meta?: Record<string, unknown>): Promise<T> {
    this.ensure(estimate);
    const { result, credits } = await fn();
    await this.record(credits, operation, meta);
    return result;
  }
}

/** One credit per contact we still need an email for. */
export function estimateEnrichmentCredits(contacts: { email?: string | null; apolloId?: string | null }[]): number {
  return contacts.filter((c) => !c.email && c.apolloId).length;
}
