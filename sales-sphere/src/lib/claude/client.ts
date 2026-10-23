import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { CallLogger } from "../audit";
import { env } from "../env";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class ClaudeRefusalError extends Error {}

/** Thin wrapper: structured JSON output, cost logging, refusal handling. Model name comes from config. */
export class Claude {
  private client: Anthropic;
  constructor(
    private opts: { logger: CallLogger; campaignId?: string | null; client?: Anthropic; model?: string; effort?: Effort },
  ) {
    this.client = opts.client ?? new Anthropic();
  }

  get model() {
    return this.opts.model ?? env.anthropicModel();
  }

  async json<S extends z.ZodType>(
    schema: S,
    p: { operation: string; system: string; prompt: string; effort?: Effort; maxTokens?: number },
  ): Promise<z.infer<S>> {
    let status: "ok" | "error" = "ok";
    let cost = 0;
    let meta: Record<string, unknown> = {};
    try {
      const res = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: p.maxTokens ?? 16000,
        // Server-side fallback: if a safety classifier declines, the API retries on its recommended model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // The system prompt is stable within a run, so cache it.
        system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: p.prompt }],
        output_config: { effort: p.effort ?? this.opts.effort ?? env.anthropicEffort(), format: betaZodOutputFormat(schema) },
      });
      const u = res.usage;
      const inTok = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
      cost = (inTok * env.anthropicInputUsdPerMTok() + (u.output_tokens ?? 0) * env.anthropicOutputUsdPerMTok()) / 1_000_000;
      meta = { model: res.model, input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, stop: res.stop_reason };
      if (res.stop_reason === "refusal") throw new ClaudeRefusalError(`Claude declined the ${p.operation} request`);
      if (res.stop_reason === "max_tokens") throw new Error(`Claude hit max_tokens on ${p.operation}`);
      if (res.parsed_output == null) throw new Error(`Claude returned no parseable output for ${p.operation}`);
      return res.parsed_output as z.infer<S>;
    } catch (e) {
      status = "error";
      meta = { ...meta, error: e instanceof Error ? e.message : String(e) };
      throw e;
    } finally {
      await this.opts.logger.log({ provider: "anthropic", operation: p.operation, cost, costUnit: "usd", status, campaignId: this.opts.campaignId, meta });
    }
  }
}

export const COMPANY_CONTEXT = `AdySphere Co is a Dubai-based Microsoft AI Cloud Partner consultancy founded by Adyasha Mallick, a hands-on consultant who runs implementations herself. Services: Dynamics 365 (Finance, Supply Chain, Sales, Customer Service), Business Central, Power Platform (Power Apps, Power Automate, Power BI), and agentic AI (Copilot Studio agents). Paid diagnostic offer: the Business X-Ray. For other Microsoft partners AdySphere offers module implementation outsourcing and AI enablement (white-label or subcontract).`;

export const TRUTH_RULES = `Truth rules (non-negotiable):
- Use only facts present in the evidence provided. Never invent facts, numbers, statistics, quotes, client names, results or dates.
- If the evidence does not support a claim, do not make it. If unsure, say so plainly.
- Never claim AdySphere has a client or result that is not listed in PROOF POINTS.`;
