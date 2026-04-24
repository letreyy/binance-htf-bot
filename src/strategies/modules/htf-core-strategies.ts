import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection, MarketRegimeType } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * HTF Liquidity Sweep — profitable in real data (1/0). Slight tightening.
 */
export class HtfLiquiditySweepStrategy implements Strategy {
    name = 'HTF Liquidity Sweep';
    id = 'htf-liquidity-sweep';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { liquidity, candles, indicators } = ctx;
        const last = candles[candles.length - 1];

        if (last.volume <= indicators.volumeSma * 1.4) return null;

        if (liquidity.sweptLow && liquidity.reclaimedLevel && liquidity.localRangeLow) {
            const sweepWickLow = Math.min(...candles.slice(-5).map(c => c.low));
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'LIMIT',
                suggestedEntry: liquidity.localRangeLow,
                suggestedTarget: liquidity.localRangeHigh || undefined,
                suggestedSl: sweepWickLow - (indicators.atr * 0.3),
                confidence: 85,
                reasons: [
                    '1H swing low sweep with volume',
                    'Range reclaimed → expecting retest',
                    `Limit at: ${liquidity.localRangeLow.toFixed(4)}`
                ],
                expireMinutes: 60 * 6
            };
        }
        if (liquidity.sweptHigh && liquidity.reclaimedLevel && liquidity.localRangeHigh) {
            const sweepWickHigh = Math.max(...candles.slice(-5).map(c => c.high));
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'LIMIT',
                suggestedEntry: liquidity.localRangeHigh,
                suggestedTarget: liquidity.localRangeLow || undefined,
                suggestedSl: sweepWickHigh + (indicators.atr * 0.3),
                confidence: 85,
                reasons: [
                    '1H swing high sweep with volume',
                    'Range reclaimed → expecting retest',
                    `Limit at: ${liquidity.localRangeHigh.toFixed(4)}`
                ],
                expireMinutes: 60 * 6
            };
        }
        return null;
    }
}

/**
 * HTF Breakout Failure — reworked.
 *
 * Previous: 0/1 at -75% — entered MARKET on the failure candle's close, catching the wick.
 * New: LIMIT at range level on retest, require return inside >= 30% of range,
 * require N+1 close back inside as confirmation.
 */
export class HtfBreakoutFailureStrategy implements Strategy {
    name = 'HTF Breakout Failure';
    id = 'htf-breakout-failure';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { liquidity, candles, indicators } = ctx;
        if (candles.length < 5) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        if (last.volume < indicators.volumeSma * 1.6) return null;
        if (!liquidity.localRangeLow || !liquidity.localRangeHigh) return null;

        const range = liquidity.localRangeHigh - liquidity.localRangeLow;
        if (range <= 0) return null;

        // Bull trap: prev broke high and closed below, OR last broke high and closed ≥30% back inside range
        const prevBroke = prev.high > liquidity.localRangeHigh && prev.close < liquidity.localRangeHigh;
        const lastBroke = last.high > liquidity.localRangeHigh && last.close < liquidity.localRangeHigh - range * 0.30;

        if (prevBroke && last.close < last.open && last.close < prev.close) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'LIMIT',
                suggestedEntry: liquidity.localRangeHigh,
                suggestedTarget: liquidity.localRangeLow,
                suggestedSl: prev.high + (indicators.atr * 0.3),
                confidence: 82,
                reasons: ['1H failed breakout above range (N+1 confirmed)', 'Bull trap + volume', 'Return to range expected'],
                expireMinutes: 240
            };
        }
        if (lastBroke) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'LIMIT',
                suggestedEntry: liquidity.localRangeHigh,
                suggestedTarget: liquidity.localRangeLow,
                suggestedSl: last.high + (indicators.atr * 0.3),
                confidence: 80,
                reasons: ['1H failed breakout: closed 30%+ back inside range', 'Bull trap + volume'],
                expireMinutes: 240
            };
        }

        const prevBrokeDown = prev.low < liquidity.localRangeLow && prev.close > liquidity.localRangeLow;
        const lastBrokeDown = last.low < liquidity.localRangeLow && last.close > liquidity.localRangeLow + range * 0.30;

        if (prevBrokeDown && last.close > last.open && last.close > prev.close) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'LIMIT',
                suggestedEntry: liquidity.localRangeLow,
                suggestedTarget: liquidity.localRangeHigh,
                suggestedSl: prev.low - (indicators.atr * 0.3),
                confidence: 82,
                reasons: ['1H failed breakdown below range (N+1 confirmed)', 'Bear trap + volume', 'Return to range expected'],
                expireMinutes: 240
            };
        }
        if (lastBrokeDown) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'LIMIT',
                suggestedEntry: liquidity.localRangeLow,
                suggestedTarget: liquidity.localRangeHigh,
                suggestedSl: last.low - (indicators.atr * 0.3),
                confidence: 80,
                reasons: ['1H failed breakdown: closed 30%+ back inside range', 'Bear trap + volume'],
                expireMinutes: 240
            };
        }

        return null;
    }
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
export class HtfVwapReversionStrategy implements Strategy {
    name = 'HTF VWAP Reversion';
    id = 'htf-vwap-reversion';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles, regime } = ctx;
        if (candles.length < 25) return null;

        if (regime.type !== MarketRegimeType.RANGE) return null;
        if (indicators.adx >= 20) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        // Use BB midline (SMA20) — more reliable than intraday VWAP on 1H
        const anchor = indicators.bbMid;
        if (anchor <= 0) return null;

        const deviationAbs = Math.abs(last.close - anchor);
        const minDeviation = indicators.atr * 2.0;
        const maxDeviation = indicators.atr * 4.0;
        if (deviationAbs < minDeviation || deviationAbs > maxDeviation) return null;

        // Anchor must be flat: SMA20 5 bars ago vs now. Build a rough SMA20 via closes.
        const closes = candles.map(c => c.close);
        const sma20Now = closes.slice(-20).reduce((s, c) => s + c, 0) / 20;
        const sma20Prior = closes.slice(-25, -5).reduce((s, c) => s + c, 0) / 20;
        const anchorSlopePct = Math.abs(sma20Now - sma20Prior) / sma20Now * 100;
        if (anchorSlopePct > 0.5) return null; // drifting anchor — no mean-reversion setup

        const volumeRatio = last.volume / indicators.volumeSma;
        if (volumeRatio < 1.3) return null;

        const deviationPct = ((last.close - anchor) / anchor * 100).toFixed(2);

        if (last.close < anchor && indicators.rsi < 32) {
            const prevReversal = prev.close > prev.open && prev.close > prev.low + (prev.high - prev.low) * 0.5;
            const lastConfirm = last.close > last.open && last.close > prev.close && last.close > prev.high;
            if (prevReversal && lastConfirm) {
                const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: anchor,
                    suggestedSl: swingLow - (indicators.atr * 0.3),
                    confidence: 76,
                    reasons: [
                        `1H stretched ${deviationPct}% below SMA20 (flat anchor)`,
                        `RSI deeply oversold: ${indicators.rsi.toFixed(0)}`,
                        '2-bar reversal + prev-bar breakout',
                        `Range + ADX ${indicators.adx.toFixed(0)}`
                    ],
                    expireMinutes: 180
                };
            }
        }

        if (last.close > anchor && indicators.rsi > 68) {
            const prevReversal = prev.close < prev.open && prev.close < prev.high - (prev.high - prev.low) * 0.5;
            const lastConfirm = last.close < last.open && last.close < prev.close && last.close < prev.low;
            if (prevReversal && lastConfirm) {
                const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: anchor,
                    suggestedSl: swingHigh + (indicators.atr * 0.3),
                    confidence: 76,
                    reasons: [
                        `1H stretched +${deviationPct}% above SMA20 (flat anchor)`,
                        `RSI deeply overbought: ${indicators.rsi.toFixed(0)}`,
                        '2-bar rejection + prev-bar breakdown',
                        `Range + ADX ${indicators.adx.toFixed(0)}`
                    ],
                    expireMinutes: 180
                };
            }
        }

        return null;
    }
}
