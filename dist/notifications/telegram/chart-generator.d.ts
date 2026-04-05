import { StrategyContext, FinalSignal } from '../../core/types/bot-types.js';
export declare class ChartGenerator {
    static generateChart(ctx: StrategyContext, signal: FinalSignal): Promise<Buffer>;
}
