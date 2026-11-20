import { ORGANIZER_LIMITS, type OrganizerSettings } from '../../../shared/src/types';
import { holdFor, MODEL_PRICES, usageCost } from './vision';

/**
 * Limits of one Organizer run scale with the photos it has to analyze, so an unattended Drive update of
 * 1000 photos never stops at photo ~300 (call limit) or at a fixed USD budget nobody is there to extend.
 *
 * Measured on the production ledgers (2026-11-19, gemini-3.1-flash-lite):
 *  - pixel analysis: ~1200 input + ~105 output tokens → USD 0.00046 per call;
 *  - interpretation / matching calls: average 1660 input + 700 output tokens → USD 0.0015 per call.
 * The estimate per call uses the matching shape (the more expensive one) with a 1.5× margin, priced with
 * `MODEL_PRICES` of the configured model, so changing model changes the estimate automatically.
 */
export const ESTIMATED_CALL_TOKENS = { input: 1700, output: 800 } as const;
export const ESTIMATE_MARGIN = 1.5;
/** Absolute per-client maxima (editable in the Organizer settings); `budgetUsd`/`maxCalls` remain the floor. */
export const DEFAULT_MAX_CALLS_CAP = 5000;
export const MAX_CALLS_CAP_LIMIT = 20_000;
export const DEFAULT_BUDGET_CAP_USD = 40;
export const BUDGET_CAP_LIMIT_USD = 500;
/** Interpretation of the workbook structure and base-code resolution are not per photo. */
export const FIXED_CALL_OVERHEAD = 50;
/** Concurrent reservations in the vision phase (see `parallel` in worker.ts). */
const PARALLEL_RESERVATIONS = 4;

type LimitConfig = Pick<OrganizerSettings, 'model' | 'escalationModel' | 'budgetUsd' | 'maxCalls' | 'maxCallsCap' | 'budgetCapUsd'>;

/** Calls one photo can need: pixels, plus matching/base resolution, plus escalation when configured. */
export const callsPerPhoto = (config: Pick<OrganizerSettings, 'model' | 'escalationModel'>) =>
  2 + (config.escalationModel && config.escalationModel !== config.model ? 1 : 0);

/** Estimated USD per photo with the configured models (escalation priced only when it differs). */
export function estimatedPhotoCostUsd(config: Pick<OrganizerSettings, 'model' | 'escalationModel'>) {
  const call = (model: string) => usageCost(model, ESTIMATED_CALL_TOKENS.input, ESTIMATED_CALL_TOKENS.output, 0) / 1_000_000;
  const escalation = config.escalationModel && config.escalationModel !== config.model ? call(config.escalationModel) : 0;
  return (2 * call(config.model) + escalation) * ESTIMATE_MARGIN;
}

/**
 * Run limits for `photos` photos to analyze. Never lower than the configured floor (`maxCalls`, `budgetUsd`)
 * or than what the run already has, never higher than the client caps. The budget keeps room for the
 * concurrent reservations, because each Gemini call reserves `holdFor(model)` before it runs.
 */
export function scaledRunLimits(photos: number, config: LimitConfig, current: { maxCalls?: number; budgetUsd: number }) {
  const callCap = Math.max(config.maxCalls ?? ORGANIZER_LIMITS.maxCalls, config.maxCallsCap ?? DEFAULT_MAX_CALLS_CAP);
  const budgetCap = Math.max(config.budgetUsd, config.budgetCapUsd ?? DEFAULT_BUDGET_CAP_USD);
  const neededCalls = Math.max(0, photos) * callsPerPhoto(config) + FIXED_CALL_OVERHEAD;
  const maxCalls = Math.max(current.maxCalls ?? config.maxCalls ?? ORGANIZER_LIMITS.maxCalls, Math.min(callCap, neededCalls));
  const holdModel = config.escalationModel && MODEL_PRICES[config.escalationModel] ? config.escalationModel : config.model;
  const reservations = MODEL_PRICES[holdModel] ? holdFor(holdModel) * PARALLEL_RESERVATIONS / 1_000_000 : 0;
  const needed = Math.ceil((Math.max(0, photos) * estimatedPhotoCostUsd(config) + reservations) * 100) / 100;
  const budgetUsd = Math.max(current.budgetUsd, Math.min(budgetCap, needed));
  return { maxCalls, budgetUsd };
}
