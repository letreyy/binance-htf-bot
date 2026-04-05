import { SignalDirection } from '../../core/constants/enums.js';
/**
 * HTF Liquidity Sweep — adapted for 1H
 *
 * On 1H, sweeps are far more significant because they represent
 * multi-hour liquidity pools rather than 15m noise.
 * - Requires 1.3× volume (vs 1.2× on 15m)
 * - Longer limit expiry (6h)
 */
export class HtfLiquiditySweepStrategy {
    name = 'HTF Liquidity Sweep';
    id = 'htf-liquidity-sweep';
    execute(ctx) {
        const { liquidity, candles, indicators } = ctx;
        const last = candles[candles.length - 1];
        if (last.volume <= indicators.volumeSma * 1.3)
            return null;
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
 * HTF Breakout Failure — adapted for 1H
 *
 * Failed breakouts on 1H are extremely significant — they represent
 * institutional stop hunts across 48h ranges.
 * - Requires 1.5× volume spike
 * - Longer expiry (2h)
 */
export class HtfBreakoutFailureStrategy {
    name = 'HTF Breakout Failure';
    id = 'htf-breakout-failure';
    execute(ctx) {
        const { liquidity, candles, indicators } = ctx;
        const last = candles[candles.length - 1];
        if (last.volume < indicators.volumeSma * 1.5)
            return null;
        if (!liquidity.localRangeLow || !liquidity.localRangeHigh)
            return null;
        if (last.high > liquidity.localRangeHigh && last.close < liquidity.localRangeHigh) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                suggestedTarget: liquidity.localRangeLow,
                suggestedSl: last.high + (indicators.atr * 0.3),
                confidence: 80,
                reasons: ['1H failed breakout above range', 'Bull trap + volume spike', 'Return to range expected'],
                expireMinutes: 120
            };
        }
        if (last.low < liquidity.localRangeLow && last.close > liquidity.localRangeLow) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                suggestedTarget: liquidity.localRangeHigh,
                suggestedSl: last.low - (indicators.atr * 0.3),
                confidence: 80,
                reasons: ['1H failed breakdown below range', 'Bear trap + volume spike', 'Return to range expected'],
                expireMinutes: 120
            };
        }
        return null;
    }
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
export class HtfVwapReversionStrategy {
    name = 'HTF VWAP Reversion';
    id = 'htf-vwap-reversion';
    execute(ctx) {
        const { indicators, candles } = ctx;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const deviationAbs = Math.abs(last.close - indicators.vwap);
        const adaptiveThreshold = indicators.atr * 2.0;
        if (deviationAbs < adaptiveThreshold)
            return null;
        const deviation = (last.close - indicators.vwap) / indicators.vwap;
        const deviationPct = (deviation * 100).toFixed(2);
        if (last.close < indicators.vwap && indicators.rsi < 38) {
            const bullishConfirm = last.close > last.open || (prev.close < indicators.vwap && last.close > prev.close);
            if (!bullishConfirm)
                return null;
            if (last.volume > indicators.volumeSma * 1.2) {
                const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: indicators.vwap,
                    suggestedSl: swingLow - (indicators.atr * 0.3),
                    confidence: 78,
                    reasons: [
                        `1H VWAP deviation: ${deviationPct}%`,
                        'RSI oversold + bullish confirmation',
                        'Mean reversion to daily VWAP'
                    ],
                    expireMinutes: 180
                };
            }
        }
        if (last.close > indicators.vwap && indicators.rsi > 62) {
            const bearishConfirm = last.close < last.open || (prev.close > indicators.vwap && last.close < prev.close);
            if (!bearishConfirm)
                return null;
            if (last.volume > indicators.volumeSma * 1.2) {
                const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: indicators.vwap,
                    suggestedSl: swingHigh + (indicators.atr * 0.3),
                    confidence: 78,
                    reasons: [
                        `1H VWAP deviation: +${deviationPct}%`,
                        'RSI overbought + bearish confirmation',
                        'Mean reversion to daily VWAP'
                    ],
                    expireMinutes: 180
                };
            }
        }
        return null;
    }
}
//# sourceMappingURL=htf-core-strategies.js.map