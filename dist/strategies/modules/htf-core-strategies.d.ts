import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { Strategy } from '../base/strategy.js';
/**
 * HTF Liquidity Sweep — profitable in real data (1/0). Slight tightening.
 */
export declare class HtfLiquiditySweepStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF Breakout Failure — reworked.
 *
 * Previous: 0/1 at -75% — entered MARKET on the failure candle's close, catching the wick.
 * New: LIMIT at range level on retest, require return inside >= 30% of range,
 * require N+1 close back inside as confirmation.
 */
export declare class HtfBreakoutFailureStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF VWAP Reversion — rebuilt.
 *
 * Previous: 0/2, -39% then 0/1 -35%. Two issues:
 *   1) VWAP resets at UTC midnight; in the first few hours of the UTC day
 *      VWAP is built from only a handful of candles, so "deviation vs VWAP"
 *      is basically noise. Fall back to BB-midline (SMA20) anchor when the
 *      VWAP sample is too thin.
 *   2) "Flat VWAP" check compared VWAP to SMA10 of closes — apples to
 *      oranges. Replaced with a real slope check against the BB midline.
 *
 * New rules:
 * - Regime RANGE + ADX < 20
 * - Use BB midline as anchor (it's more stable than intraday VWAP on 1H)
 * - Require deviation 2–4 ATR from anchor
 * - Anchor (SMA20) must be genuinely flat: slope over 5 bars < 0.5%
 * - 2-bar reversal: prev started the reversal, last confirms with breakout
 */
export declare class HtfVwapReversionStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
