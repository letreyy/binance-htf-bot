import { StrategyContext, SignalLevels, StrategySignalCandidate } from '../core/types/bot-types.js';
export declare class RiskEngine {
    static calculateLevels(ctx: StrategyContext, candidate: StrategySignalCandidate): SignalLevels;
}
