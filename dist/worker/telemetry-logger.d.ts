import { StrategySignalCandidate, SignalLevels } from '../core/types/bot-types.js';
export declare class TelemetryLogger {
    private static initialized;
    static log(symbol: string, candidate: StrategySignalCandidate, levels?: SignalLevels, score?: number): void;
    private static init;
}
