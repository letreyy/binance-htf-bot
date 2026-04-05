import { StrategySignalCandidate, StrategyContext } from '../core/types/bot-types.js';
interface ComboDefinition {
    name: string;
    id: string;
    requiredStrategies: string[];
    minMatch: number;
    contextFilter?: (ctx: StrategyContext) => boolean;
    confidence: number;
    reasons: string[];
    expireMinutes: number;
}
export declare const COMBO_DEFINITIONS: ComboDefinition[];
export declare class CombinationEngine {
    static evaluate(individualSignals: StrategySignalCandidate[], ctx: StrategyContext): StrategySignalCandidate[];
    private static checkCombo;
}
export {};
