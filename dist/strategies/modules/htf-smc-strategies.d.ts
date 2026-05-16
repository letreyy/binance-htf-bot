import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { Strategy } from '../base/strategy.js';
/**
 * HTF Order Block Retest — profitable in real data (2W/1L). Kept logic, tightened volume.
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
/**
 * HTF OB Magnet — heavily restricted. Previous: 0/2, -26%.
 * Only fires in RANGE regime with ADX<18 and RSI extreme.
 */
export declare class HtfObMagnetStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF FVG Magnet — heavily restricted. Previous: 0/2, -57%.
 * Only fires in RANGE regime with ADX<18 and RSI extreme.
 */
export declare class HtfFvgMagnetStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
