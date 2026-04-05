import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { Strategy } from '../base/strategy.js';
/**
 * HTF Liquidity Sweep — adapted for 1H
 *
 * On 1H, sweeps are far more significant because they represent
 * multi-hour liquidity pools rather than 15m noise.
 * - Requires 1.3× volume (vs 1.2× on 15m)
 * - Longer limit expiry (6h)
 */
export declare class HtfLiquiditySweepStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF Breakout Failure — adapted for 1H
 *
 * Failed breakouts on 1H are extremely significant — they represent
 * institutional stop hunts across 48h ranges.
 * - Requires 1.5× volume spike
 * - Longer expiry (2h)
 */
export declare class HtfBreakoutFailureStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF VWAP Reversion — adapted for 1H
 *
 * VWAP mean reversion is even MORE reliable on HTF because
 * daily VWAP acts as an institutional fair value anchor.
 * - Wider adaptive threshold (2× ATR instead of 1.5×)
 * - RSI thresholds relaxed slightly (< 38 / > 62)
 * - Volume requirement: 1.2× avg
 * - Expiry: 3h
 */
export declare class HtfVwapReversionStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
