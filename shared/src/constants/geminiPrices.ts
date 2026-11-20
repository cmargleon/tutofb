/** Standard paid Gemini Developer API rates for text/image input and text output.
 * Thinking is billed at the output rate, separately reported by usageMetadata.
 * No Batch/Flex discounts, cache discounts, audio, image output or grounding fees.
 */
export const GEMINI_PRICING_SOURCE = 'https://ai.google.dev/gemini-api/docs/pricing';
export const GEMINI_PRICING_VERIFIED_AT = '2026-11-20';
export type GeminiPricingStatus = 'verified' | 'unverified' | 'unknown_model';
export interface GeminiTokenRates {
  input: number;
  output: number;
  reasoning: number;
}
export interface GeminiModelPrice extends GeminiTokenRates {
  verifiedAt: string | null;
  checkedAt: string;
  sourceUrl: string;
  status: Exclude<GeminiPricingStatus, 'unknown_model'>;
  longContext?: GeminiTokenRates & { aboveInputTokens: number };
  scheduled?: GeminiTokenRates & { effectiveFrom: string };
}
const verified = (input: number, output: number): GeminiModelPrice => ({
  input, output, reasoning: output, verifiedAt: GEMINI_PRICING_VERIFIED_AT,
  checkedAt: GEMINI_PRICING_VERIFIED_AT, sourceUrl: GEMINI_PRICING_SOURCE, status: 'verified',
});
const pro: GeminiModelPrice = { ...verified(2, 12), longContext: { aboveInputTokens: 200_000, input: 4, output: 18, reasoning: 18 } };
// Highest confirmed applicable rates (including long context), never Flash-Lite.
export const GEMINI_CONSERVATIVE_RATES: GeminiTokenRates = { input: pro.longContext!.input, output: pro.longContext!.output, reasoning: pro.longContext!.reasoning };
const unverified = (): GeminiModelPrice => ({ ...GEMINI_CONSERVATIVE_RATES, verifiedAt: null,
  checkedAt: GEMINI_PRICING_VERIFIED_AT, sourceUrl: GEMINI_PRICING_SOURCE, status: 'unverified' });
export const GEMINI_MODEL_PRICES: Readonly<Record<string, GeminiModelPrice>> = {
  'gemini-3.1-flash-lite': verified(.25, 1.5),
  // Preview alias is still configured in production but absent from the current rate card.
  'gemini-3.1-flash-lite-preview': unverified(),
  'gemini-3-flash-preview': verified(.5, 3),
  'gemini-3.8-flash': { ...verified(.75, 3.75), scheduled: { effectiveFrom: '2027-01-01T00:00:00Z', input: 1.5, output: 7.5, reasoning: 7.5 } },
  'gemini-3.1-pro-preview': pro,
  'gemini-3.1-pro-preview-customtools': pro,
  // Legacy UI suggestions are no longer listed on the official pricing page.
  'gemini-1.5-flash': unverified(),
  'gemini-1.5-pro': unverified(),
  'gemini-2.0-flash': unverified(),
};
export function geminiModelRates(model: string, inputTokens: number, at = new Date()) {
  const price = Object.hasOwn(GEMINI_MODEL_PRICES, model) ? GEMINI_MODEL_PRICES[model] : undefined;
  const rates = !price ? GEMINI_CONSERVATIVE_RATES
    : price.scheduled && at.getTime() >= Date.parse(price.scheduled.effectiveFrom) ? price.scheduled
    : price.longContext && inputTokens > price.longContext.aboveInputTokens ? price.longContext : price;
  return { ...rates, pricingStatus: price?.status ?? 'unknown_model' as GeminiPricingStatus,
    pricingVerifiedAt: price?.verifiedAt ?? null, pricingSourceUrl: GEMINI_PRICING_SOURCE };
}
const tokens = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
export function geminiUsageCost(model: string, input: number, output: number, reasoning: number, at = new Date()) {
  const rates = geminiModelRates(model, tokens(input), at);
  return Number(((tokens(input) * rates.input + tokens(output) * rates.output + tokens(reasoning) * rates.reasoning) / 1_000_000).toFixed(6));
}
/** Conservative ordinary-call envelope, not a contractual spending cap.
 * 32k input, 8k response and 64k thinking at the highest known rates.
 * Larger/custom contexts can exceed this estimate; uncertain calls retain it.
 */
export const GEMINI_CONSERVATIVE_HOLD_USD = Math.ceil((32_768 * GEMINI_CONSERVATIVE_RATES.input
  + 8192 * GEMINI_CONSERVATIVE_RATES.output + 65_536 * GEMINI_CONSERVATIVE_RATES.reasoning) / 10_000) / 100;
