import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { Strategy } from '../base/strategy.js';
/**
 * HTF Funding Skew Reversal
 *
 * Extreme funding means one side is crowded — over-leveraged longs/shorts
 * get liquidated into a mean-reverting move. We wait for confirmation that
 * the crowded side is starting to flush.
 *
 * - |funding| >= 0.05% (8h rate) — genuine crowding
 * - RANGE regime + ADX < 22 (no strong directional trend to fight)
 * - Price stretched from VWAP by >= 1.5 ATR in the crowded direction
 * - Reversal candle (close against the crowd)
 */
export declare class HtfFundingSkewStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF Range Retest Continuation
 *
 * After a clean range breakout with volume, the former range boundary flips
 * from resistance to support (or vice versa). We enter on the first retest.
 *
 * - Price was in a tight range for >= 20 bars
 * - Breakout candle closed beyond range with body >= 50% of range, volume >= 1.6×
 * - Current candle retests the broken level (within 0.3 ATR) and bounces
 * - HTF trend (EMA200) aligned with breakout direction
 */
export declare class HtfRangeRetestStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF Wyckoff Spring / Upthrust
 *
 * Classic Wyckoff accumulation/distribution shakeout.
 *
 * Spring (LONG):
 *   - Range established for >= 15 bars
 *   - Price dips below range low (wick or close) on one candle
 *   - That candle closes back inside the range (upper 50% of its own body)
 *   - N+1 confirms with higher close than the spring candle
 *   - Volume on spring >= 1.5× (test of supply)
 *
 * Upthrust (SHORT): mirror image.
 */
export declare class HtfWyckoffSpringStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF Open Interest Divergence
 *
 * Rising OI during a price stall or counter move = new positions entering
 * the losing side (trapped). When OI spikes and price diverges from it,
 * the trapped side eventually unwinds — we fade the trapped crowd.
 *
 * - OI history available (30 bars of 1h data)
 * - OI rose >= 6% in last 5 bars
 * - Price over that window is either flat (<1 ATR change) or counter-move
 * - Confirmation candle in the direction of the expected unwind
 */
export declare class HtfOpenInterestDivergenceStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
