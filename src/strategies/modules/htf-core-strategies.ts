import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
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
 * HTF VWAP Reversion — reworked.
 *
 * Previous: 0/2, -39%. Fired during trending markets thanks to the mean-rev bypass,
 * which is now removed. Added: flat-VWAP requirement + stretch cap.
 */
export class HtfVwapReversionStrategy implements Strategy {
    name = 'HTF VWAP Reversion';
    id = 'htf-vwap-reversion';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles } = ctx;
        if (candles.length < 15) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        const deviationAbs = Math.abs(last.close - indicators.vwap);
        const adaptiveThreshold = indicators.atr * 2.0;
        if (deviationAbs < adaptiveThreshold) return null;

        // Extreme stretch: skip (strong move, not mean-reversion)
        if (deviationAbs > indicators.atr * 5) return null;

        // VWAP must be relatively flat — if it's running with the move, no mean-rev
        const vwapApprox10 = candles.slice(-11, -1).reduce((s, c) => s + c.close, 0) / 10;
        const vwapSlopePct = Math.abs(indicators.vwap - vwapApprox10) / indicators.vwap * 100;
        if (vwapSlopePct > 0.8) return null;

        const deviation = (last.close - indicators.vwap) / indicators.vwap;
        const deviationPct = (deviation * 100).toFixed(2);

        if (last.close < indicators.vwap && indicators.rsi < 36) {
            const bullishConfirm = last.close > last.open && last.close > prev.close;
            if (!bullishConfirm) return null;
            if (last.volume > indicators.volumeSma * 1.3) {
                const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: indicators.vwap,
                    suggestedSl: swingLow - (indicators.atr * 0.3),
                    confidence: 78,
                    reasons: [
                        `1H VWAP deviation: ${deviationPct}% (flat VWAP)`,
                        'RSI oversold + bullish confirmation',
                        'Mean reversion to daily VWAP'
                    ],
                    expireMinutes: 180
                };
            }
        }

        if (last.close > indicators.vwap && indicators.rsi > 64) {
            const bearishConfirm = last.close < last.open && last.close < prev.close;
            if (!bearishConfirm) return null;
            if (last.volume > indicators.volumeSma * 1.3) {
                const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: indicators.vwap,
                    suggestedSl: swingHigh + (indicators.atr * 0.3),
                    confidence: 78,
                    reasons: [
                        `1H VWAP deviation: +${deviationPct}% (flat VWAP)`,
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
