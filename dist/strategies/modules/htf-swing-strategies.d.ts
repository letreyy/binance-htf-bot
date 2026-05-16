import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { Strategy } from '../base/strategy.js';
/**
 * HTF EMA Pullback — reworked for 1H
 *
 * Previous version (1W/4L, -38%) entered on the pullback candle itself,
 * which was too early — price often pierced EMA and kept going.
 *
 * New rules:
 * - Candle N touches EMA20/50 (within 0.3×ATR)
 * - Candle N+1 closes back in trend direction, body > 50% of range, close beyond EMA
 * - ADX > 25 AND rising (> prev ADX)
 * - Structure confirmation: prior HH/HL within last 20 candles (for longs)
 */
export declare class HtfEmaPullbackStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
export declare class HtfRsiDivergenceStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
    private estimateRsiFromPrice;
    /**
     * Find the MOST RECENT confirmed fractal swing low that is at least
     * `minGap` bars away from the last candle. This fixes the earlier bug
     * where we picked the LOWEST swing in the window, which in a downtrend
     * is almost always the most recent one and causes us to fade fresh
     * breakdowns.
     */
    private findMostRecentSwingLow;
    private findMostRecentSwingHigh;
}
/**
 * HTF EMA Cross Momentum — adapted for 1H (small tightening)
 */
export declare class HtfEmaCrossMomentumStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF Bollinger Band Reversal — rebuilt.
 *
 * Previous: -12.5% in 1 trade (0/1). Before that 2W/3L negative expectancy.
 *
 * Core issue: band reclaims fire beautifully during fakeouts in ranges but
 * are death traps in trending/expanding-vol markets. Added regime gate
 * and stricter BB-not-expanding check.
 *
 * New rules:
 * - Regime RANGE + ADX < 20 (no trending)
 * - BB width has been NARROWING over last 5 bars (true consolidation)
 * - Spike candle (prev) pierces band; two successive bars close back inside
 * - RSI at extreme (< 30 or > 70, tightened)
 * - Not stretched from EMA200 (|price-ema200|/atr < 3.5)
 */
export declare class HtfBollingerReversalStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF Volume Climax — heavily reworked.
 *
 * Previous: 0/3, -117%, avg loss -39%. Entered MARKET into the climax wick.
 *
 * New rules:
 * - Climax candle N has volume >= 3× and wick >= 55% of range
 * - MUST be at a key level: prior 48h swing high/low OR BB band OR VWAP±2 ATR
 * - Wait for candle N+1 that closes back past the climax body midpoint
 * - Use LIMIT on 50% retrace, not MARKET into the wick
 */
export declare class HtfVolumeClimaxStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
export declare class HtfDeltaDivergenceStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
