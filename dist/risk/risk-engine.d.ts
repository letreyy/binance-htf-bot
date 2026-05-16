import { StrategyContext, SignalLevels, StrategySignalCandidate } from '../core/types/bot-types.js';
export declare const REJECT_SL_ABOVE_PCT = 6;
export declare class RiskEngine {
    /**
     * Returns null if the strategy's suggested SL is too wide to trade sanely.
     * Wide SLs are the #1 source of catastrophic losses — artificially tightening
     * them creates "guaranteed stop-outs", so we reject the signal instead.
     */
    static calculateLevels(ctx: StrategyContext, candidate: StrategySignalCandidate): SignalLevels | null;
}
