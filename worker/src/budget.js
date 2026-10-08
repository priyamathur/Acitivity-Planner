// Monthly AI spending cap. Every Claude response reports its token use; we price
// it here and keep a running total for the month in the Durable Object. Once the
// month's budget is reached, AI features pause (the rest of the app keeps working)
// until the 1st of the next month (UTC).
//
// Prices are USD per million tokens, from Anthropic's published list prices
// (checked 2026-10; verify at anthropic.com/pricing if they change).
// Cache writes are billed at 1.25x input (5-minute cache); web searches $10 / 1,000.
const PRICES = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1 },
};
const FALLBACK_PRICE = { in: 5, out: 25, cacheRead: 0.5 }; // unknown/fallback models: assume Opus-tier or higher
const WEB_SEARCH_USD = 0.01;

export const monthKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);

export function costUsd(model, usage = {}) {
  const p = PRICES[model] || FALLBACK_PRICE;
  const m = 1e6;
  return ((usage.input_tokens || 0) * p.in
    + (usage.cache_creation_input_tokens || 0) * p.in * 1.25
    + (usage.cache_read_input_tokens || 0) * p.cacheRead
    + (usage.output_tokens || 0) * p.out) / m
    + (usage.server_tool_use?.web_search_requests || 0) * WEB_SEARCH_USD;
}

export const budgetUsd = (env) => {
  const b = Number(env.MONTHLY_AI_BUDGET_USD);
  return Number.isFinite(b) && b >= 0 ? b : 4.5;
};
