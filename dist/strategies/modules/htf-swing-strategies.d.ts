import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { Strategy } from '../base/strategy.js';
/**
 * HTF EMA Trend Pullback — NEW strategy for 1H
 *
 * Classic swing trading setup:
 * In a strong 1H trend, wait for a pullback to EMA20/EMA50,
 * then enter on a confirmation candle bouncing off the EMA.
 *
 * Conditions:
 * - EMA20 > EMA50 > EMA200 (bullish) or reverse (bearish)
 * - ADX > 25 (confirmed trend)
 * - Price pulls back to touch EMA20 or EMA50 (within 0.2× ATR)
 * - Confirmation: candle closes in trend direction with body > 40% of range
 * - Expiry: 4h
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
    private findPriorSwingLow;
    private findPriorSwingHigh;
}
/**
 * HTF EMA Cross Momentum — adapted for 1H
 *
 * Golden/Death cross on 1H is a strong swing signal.
 * - ADX > 22 (slightly relaxed vs 15m)
 * - Volume > 1.3x (1H candles already aggregate more volume)
 * - Target: 3.5× ATR
 * - Expiry: 4h
 */
export declare class HtfEmaCrossMomentumStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF Bollinger Band Reversal — adapted for 1H
 *
 * BB reversals on 1H are more reliable than 15m.
 * - BB width check: > 1.0% (vs 0.8% on 15m)
 * - Volume: > 1.2× (vs 1.3 on 15m — 1H already has volume aggregated)
 * - Expiry: 3h
 */
export declare class HtfBollingerReversalStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
/**
 * HTF Volume Climax Reversal — adapted for 1H
 *
 * Volume climax candles on 1H represent massive institutional activity.
 * - Volume threshold: 2.5× (reduced from 3× since 1H aggregates naturally)
 * - Wick ratio: >= 50% (slightly relaxed)
 * - Trend lookback: 8 candles (= 8 hours)
 * - Min trend candles: 4
 * - Expiry: 3h
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
