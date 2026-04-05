import { StrategyContext, StrategySignalCandidate } from '../core/types/bot-types.js';
export declare class ScoringEngine {
    static calculate(ctx: StrategyContext, candidate: StrategySignalCandidate): {
        score: number;
        label: string;
    };
}
