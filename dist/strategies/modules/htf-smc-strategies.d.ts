import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { Strategy } from '../base/strategy.js';
/**
 * HTF Order Block Retest — adapted for 1H
 *
 * On 1H, order blocks are more significant and longer-lasting.
 * - Wider lookback (24 candles = 24 hours)
 * - Larger impulse threshold (2× ATR)
 * - Longer expiry (24h for limit orders)
 * - Approach zone widened to 3%
 */
export declare class HtfOrderBlockStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
export declare class HtfFairValueGapStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
export declare class HtfObMagnetStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
export declare class HtfFvgMagnetStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
