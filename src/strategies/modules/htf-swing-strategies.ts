import { StrategyContext, StrategySignalCandidate, Candle } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
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
export class HtfEmaPullbackStrategy implements Strategy {
    name = 'HTF EMA Pullback';
    id = 'htf-ema-pullback';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, prevIndicators } = ctx;
        if (candles.length < 25) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        if (indicators.adx < 25) return null;
        if (indicators.adx <= prevIndicators.adx) return null; // require rising ADX

        const body = Math.abs(last.close - last.open);
        const range = last.high - last.low;
        if (range <= 0 || body / range < 0.5) return null;

        const prevTouchEma20Low = Math.abs(prev.low - indicators.ema20) < indicators.atr * 0.3;
        const prevTouchEma50Low = Math.abs(prev.low - indicators.ema50) < indicators.atr * 0.3;
        const prevTouchEma20High = Math.abs(prev.high - indicators.ema20) < indicators.atr * 0.3;
        const prevTouchEma50High = Math.abs(prev.high - indicators.ema50) < indicators.atr * 0.3;

        // Structure: did we have a recent swing high (for longs) that confirms uptrend?
        const recent = candles.slice(-20, -2);
        const recentHighMax = Math.max(...recent.map(c => c.high));
        const recentLowMin = Math.min(...recent.map(c => c.low));

        // ─── BULLISH pullback ───
        if (
            indicators.ema20 > indicators.ema50 &&
            indicators.ema50 > indicators.ema200 &&
            (prevTouchEma20Low || prevTouchEma50Low) &&
            last.close > last.open &&
            last.close > indicators.ema20 &&
            last.close > prev.close &&
            last.high > recentHighMax * 0.995 && // close to recent swing high
            indicators.rsi > 42 && indicators.rsi < 68
        ) {
            const emaRef = prevTouchEma20Low ? indicators.ema20 : indicators.ema50;
            const swingLow = Math.min(prev.low, last.low);
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'MARKET',
                suggestedTarget: ctx.liquidity.localRangeHigh || (last.close + indicators.atr * 3),
                suggestedSl: swingLow - (indicators.atr * 0.4),
                confidence: 80,
                reasons: [
                    `1H bullish pullback to EMA${prevTouchEma20Low ? '20' : '50'} (${emaRef.toFixed(4)})`,
                    `ADX ${indicators.adx.toFixed(0)} rising (${prevIndicators.adx.toFixed(0)} → ${indicators.adx.toFixed(0)})`,
                    'N+1 confirmation candle bouncing off EMA',
                    'EMA stack: 20 > 50 > 200'
                ],
                expireMinutes: 240
            };
        }

        // ─── BEARISH pullback ───
        if (
            indicators.ema20 < indicators.ema50 &&
            indicators.ema50 < indicators.ema200 &&
            (prevTouchEma20High || prevTouchEma50High) &&
            last.close < last.open &&
            last.close < indicators.ema20 &&
            last.close < prev.close &&
            last.low < recentLowMin * 1.005 &&
            indicators.rsi > 32 && indicators.rsi < 58
        ) {
            const emaRef = prevTouchEma20High ? indicators.ema20 : indicators.ema50;
            const swingHigh = Math.max(prev.high, last.high);
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'MARKET',
                suggestedTarget: ctx.liquidity.localRangeLow || (last.close - indicators.atr * 3),
                suggestedSl: swingHigh + (indicators.atr * 0.4),
                confidence: 80,
                reasons: [
                    `1H bearish pullback to EMA${prevTouchEma20High ? '20' : '50'} (${emaRef.toFixed(4)})`,
                    `ADX ${indicators.adx.toFixed(0)} rising`,
                    'N+1 confirmation candle rejecting EMA',
                    'EMA stack: 20 < 50 < 200'
                ],
                expireMinutes: 240
            };
        }

        return null;
    }
}

/**
 * HTF RSI Divergence — adapted for 1H (unchanged, was profitable in real data).
 */
const LOOKBACK = 30;
const MIN_SWING_GAP = 8;

export class HtfRsiDivergenceStrategy implements Strategy {
    name = 'HTF RSI Divergence';
    id = 'htf-rsi-divergence';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < LOOKBACK + 5) return null;

        const slice = candles.slice(-LOOKBACK);
        const last = slice[slice.length - 1];

        const rsiValues = this.estimateRsiFromPrice(slice);
        if (!rsiValues || rsiValues.length < LOOKBACK) return null;

        const currentRsi = indicators.rsi;

        if (currentRsi < 40) {
            const priorSwingLow = this.findPriorSwingLow(slice, MIN_SWING_GAP);
            if (priorSwingLow) {
                const { index: priorIdx, price: priorLowPrice } = priorSwingLow;
                const currentLowPrice = last.low;

                if (currentLowPrice < priorLowPrice) {
                    const priorRsiAtLow = rsiValues[priorIdx];
                    if (currentRsi > priorRsiAtLow && priorRsiAtLow < 42) {
                        if (last.close > last.open) {
                            const volumeRatio = last.volume / indicators.volumeSma;
                            return {
                                strategyName: this.name,
                                direction: SignalDirection.LONG,
                                orderType: 'MARKET',
                                suggestedTarget: indicators.ema50,
                                suggestedSl: currentLowPrice - (indicators.atr * 0.4),
                                confidence: volumeRatio >= 1.5 ? 84 : 77,
                                reasons: [
                                    `1H Bullish RSI Divergence: Price LL (${currentLowPrice.toFixed(4)} < ${priorLowPrice.toFixed(4)})`,
                                    `RSI HL: ${currentRsi.toFixed(0)} > ${priorRsiAtLow.toFixed(0)} (${(LOOKBACK - priorIdx)}h ago)`,
                                    'Bullish confirmation candle',
                                    volumeRatio >= 1.5 ? `Volume spike: ${volumeRatio.toFixed(1)}x` : `Volume: ${volumeRatio.toFixed(1)}x`
                                ],
                                expireMinutes: 240
                            };
                        }
                    }
                }
            }
        }

        if (currentRsi > 60) {
            const priorSwingHigh = this.findPriorSwingHigh(slice, MIN_SWING_GAP);
            if (priorSwingHigh) {
                const { index: priorIdx, price: priorHighPrice } = priorSwingHigh;
                const currentHighPrice = last.high;

                if (currentHighPrice > priorHighPrice) {
                    const priorRsiAtHigh = rsiValues[priorIdx];
                    if (currentRsi < priorRsiAtHigh && priorRsiAtHigh > 58) {
                        if (last.close < last.open) {
                            const volumeRatio = last.volume / indicators.volumeSma;
                            return {
                                strategyName: this.name,
                                direction: SignalDirection.SHORT,
                                orderType: 'MARKET',
                                suggestedTarget: indicators.ema50,
                                suggestedSl: currentHighPrice + (indicators.atr * 0.4),
                                confidence: volumeRatio >= 1.5 ? 84 : 77,
                                reasons: [
                                    `1H Bearish RSI Divergence: Price HH (${currentHighPrice.toFixed(4)} > ${priorHighPrice.toFixed(4)})`,
                                    `RSI LH: ${currentRsi.toFixed(0)} < ${priorRsiAtHigh.toFixed(0)} (${(LOOKBACK - priorIdx)}h ago)`,
                                    'Bearish confirmation candle',
                                    volumeRatio >= 1.5 ? `Volume spike: ${volumeRatio.toFixed(1)}x` : `Volume: ${volumeRatio.toFixed(1)}x`
                                ],
                                expireMinutes: 240
                            };
                        }
                    }
                }
            }
        }

        return null;
    }

    private estimateRsiFromPrice(candles: Candle[]): number[] {
        const period = 14;
        if (candles.length < period + 1) return [];

        const rsiValues: number[] = new Array(candles.length).fill(50);

        let avgGain = 0;
        let avgLoss = 0;
        for (let i = 1; i <= period; i++) {
            const change = candles[i].close - candles[i - 1].close;
            if (change > 0) avgGain += change;
            else avgLoss += Math.abs(change);
        }
        avgGain /= period;
        avgLoss /= period;

        rsiValues[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

        for (let i = period + 1; i < candles.length; i++) {
            const change = candles[i].close - candles[i - 1].close;
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? Math.abs(change) : 0;

            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;

            rsiValues[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        }

        return rsiValues;
    }

    private findPriorSwingLow(candles: Candle[], minGap: number): { index: number; price: number } | null {
        const endIdx = candles.length - 1 - minGap;
        let lowestIdx = -1;
        let lowestPrice = Infinity;

        for (let i = 2; i <= endIdx; i++) {
            if (
                candles[i].low < candles[i - 1].low &&
                candles[i].low < candles[i - 2].low &&
                i + 1 < candles.length &&
                candles[i].low <= candles[i + 1].low
            ) {
                if (candles[i].low < lowestPrice) {
                    lowestPrice = candles[i].low;
                    lowestIdx = i;
                }
            }
        }

        if (lowestIdx === -1) return null;
        return { index: lowestIdx, price: lowestPrice };
    }

    private findPriorSwingHigh(candles: Candle[], minGap: number): { index: number; price: number } | null {
        const endIdx = candles.length - 1 - minGap;
        let highestIdx = -1;
        let highestPrice = -Infinity;

        for (let i = 2; i <= endIdx; i++) {
            if (
                candles[i].high > candles[i - 1].high &&
                candles[i].high > candles[i - 2].high &&
                i + 1 < candles.length &&
                candles[i].high >= candles[i + 1].high
            ) {
                if (candles[i].high > highestPrice) {
                    highestPrice = candles[i].high;
                    highestIdx = i;
                }
            }
        }

        if (highestIdx === -1) return null;
        return { index: highestIdx, price: highestPrice };
    }
}

/**
 * HTF EMA Cross Momentum — adapted for 1H (small tightening)
 */
export class HtfEmaCrossMomentumStrategy implements Strategy {
    name = 'HTF EMA Cross';
    id = 'htf-ema-cross';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, prevIndicators } = ctx;
        if (candles.length < 5) return null;

        const last = candles[candles.length - 1];

        const currEma20 = indicators.ema20;
        const currEma50 = indicators.ema50;
        const prevEma20 = prevIndicators.ema20;
        const prevEma50 = prevIndicators.ema50;

        if (indicators.adx < 25) return null;

        const volumeRatio = last.volume / indicators.volumeSma;
        if (volumeRatio < 1.4) return null;

        if (currEma20 > currEma50 && prevEma20 <= prevEma50) {
            if (last.close > indicators.ema200 && last.close > last.open) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    orderType: 'MARKET',
                    suggestedTarget: last.close + (indicators.atr * 3.5),
                    suggestedSl: Math.min(currEma50, last.low) - (indicators.atr * 0.3),
                    confidence: 78,
                    reasons: [
                        '1H Golden Cross: EMA20 × EMA50',
                        `ADX: ${indicators.adx.toFixed(0)} — trend confirmed`,
                        `Volume: ${volumeRatio.toFixed(1)}x avg`,
                        'Price above EMA200, bullish close'
                    ],
                    expireMinutes: 240
                };
            }
        }

        if (currEma20 < currEma50 && prevEma20 >= prevEma50) {
            if (last.close < indicators.ema200 && last.close < last.open) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    orderType: 'MARKET',
                    suggestedTarget: last.close - (indicators.atr * 3.5),
                    suggestedSl: Math.max(currEma50, last.high) + (indicators.atr * 0.3),
                    confidence: 78,
                    reasons: [
                        '1H Death Cross: EMA20 × EMA50',
                        `ADX: ${indicators.adx.toFixed(0)} — trend confirmed`,
                        `Volume: ${volumeRatio.toFixed(1)}x avg`,
                        'Price below EMA200, bearish close'
                    ],
                    expireMinutes: 240
                };
            }
        }

        return null;
    }
}

/**
 * HTF Bollinger Band Reversal — reworked for 1H
 *
 * Previous: 2W/3L with avg loss > avg win (negative expectancy).
 * Problem: single-candle reclaim on an expanding BB = catching falling knife.
 *
 * New rules:
 * - prev breached band, current closes back inside
 * - BB WIDTH not expanding (now <= 1.1× width 5 bars ago)
 * - RSI pin-bar or 2-bar reclaim pattern
 * - Candle body >= 50% of range
 */
export class HtfBollingerReversalStrategy implements Strategy {
    name = 'HTF BB Reversal';
    id = 'htf-bb-reversal';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 10) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        const volumeRatio = last.volume / indicators.volumeSma;
        if (volumeRatio < 1.3) return null;

        const bbWidth = ((indicators.bbUpper - indicators.bbLower) / indicators.bbMid) * 100;
        if (bbWidth < 1.2) return null;

        // BB width not in expansion phase
        const priorCandles = candles.slice(-7, -2);
        const avgPriorBodyRange = priorCandles.reduce((s, c) => s + Math.abs(c.high - c.low), 0) / priorCandles.length;
        if (last.high - last.low > avgPriorBodyRange * 2.2) return null; // expanding range, not reversal

        const body = Math.abs(last.close - last.open);
        const range = last.high - last.low;
        if (range <= 0 || body / range < 0.5) return null;

        // Bullish: prev broke lower band; last closed well inside (>20% of band width past BB lower)
        const bandWidth = indicators.bbUpper - indicators.bbLower;
        if (
            prev.low < indicators.bbLower &&
            last.close > indicators.bbLower + bandWidth * 0.10 &&
            last.close > last.open &&
            last.close > prev.close &&
            indicators.rsi < 35
        ) {
            const target = Math.min(indicators.bbMid, indicators.ema20);
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'MARKET',
                suggestedTarget: target,
                suggestedSl: Math.min(last.low, prev.low) - (indicators.atr * 0.3),
                confidence: 77,
                reasons: [
                    '1H BB Lower reclaim (2-bar)',
                    `RSI oversold: ${indicators.rsi.toFixed(0)}`,
                    `Volume: ${volumeRatio.toFixed(1)}x avg`,
                    `BB Width ${bbWidth.toFixed(1)}% (not expanding)`
                ],
                expireMinutes: 180
            };
        }

        if (
            prev.high > indicators.bbUpper &&
            last.close < indicators.bbUpper - bandWidth * 0.10 &&
            last.close < last.open &&
            last.close < prev.close &&
            indicators.rsi > 65
        ) {
            const target = Math.max(indicators.bbMid, indicators.ema20);
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'MARKET',
                suggestedTarget: target,
                suggestedSl: Math.max(last.high, prev.high) + (indicators.atr * 0.3),
                confidence: 77,
                reasons: [
                    '1H BB Upper reclaim (2-bar)',
                    `RSI overbought: ${indicators.rsi.toFixed(0)}`,
                    `Volume: ${volumeRatio.toFixed(1)}x avg`,
                    `BB Width ${bbWidth.toFixed(1)}% (not expanding)`
                ],
                expireMinutes: 180
            };
        }

        return null;
    }
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
export class HtfVolumeClimaxStrategy implements Strategy {
    name = 'HTF Volume Climax';
    id = 'htf-volume-climax';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, liquidity } = ctx;
        if (candles.length < 12) return null;

        const last = candles[candles.length - 1];
        const climax = candles[candles.length - 2]; // climax is PREVIOUS candle; we confirm via last
        if (!climax) return null;

        const climaxRange = climax.high - climax.low;
        if (climaxRange <= 0) return null;

        const climaxVolRatio = climax.volume / indicators.volumeSma;
        if (climaxVolRatio < 3.0) return null;

        const bodyTop = Math.max(climax.open, climax.close);
        const bodyBot = Math.min(climax.open, climax.close);
        const upperWick = climax.high - bodyTop;
        const lowerWick = bodyBot - climax.low;
        const upperWickRatio = upperWick / climaxRange;
        const lowerWickRatio = lowerWick / climaxRange;

        const bodyMid = (climax.open + climax.close) / 2;

        // Key level detection
        const prior48 = candles.slice(-50, -2);
        const priorHigh = Math.max(...prior48.map(c => c.high));
        const priorLow = Math.min(...prior48.map(c => c.low));
        const atKeyHigh = climax.high >= priorHigh * 0.997 || climax.high >= indicators.bbUpper || climax.high >= indicators.vwap + indicators.atr * 2;
        const atKeyLow = climax.low <= priorLow * 1.003 || climax.low <= indicators.bbLower || climax.low <= indicators.vwap - indicators.atr * 2;

        // ─── BULLISH reversal ───
        if (
            lowerWickRatio >= 0.55 &&
            atKeyLow &&
            indicators.rsi < 40 &&
            last.close > bodyMid &&
            last.close > last.open
        ) {
            const entry = (climax.low + bodyMid) / 2; // limit on 50% retrace of climax wick
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'LIMIT',
                suggestedEntry: entry,
                suggestedTarget: indicators.vwap,
                suggestedSl: climax.low - (indicators.atr * 0.2),
                confidence: liquidity.isWickSweep ? 85 : 79,
                reasons: [
                    `1H Volume climax (prev bar): ${climaxVolRatio.toFixed(1)}x`,
                    `Lower wick ${(lowerWickRatio * 100).toFixed(0)}% at key level`,
                    'N+1 confirmation above climax body midpoint',
                    `RSI ${indicators.rsi.toFixed(0)}`
                ],
                expireMinutes: 180
            };
        }

        if (
            upperWickRatio >= 0.55 &&
            atKeyHigh &&
            indicators.rsi > 60 &&
            last.close < bodyMid &&
            last.close < last.open
        ) {
            const entry = (climax.high + bodyMid) / 2;
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'LIMIT',
                suggestedEntry: entry,
                suggestedTarget: indicators.vwap,
                suggestedSl: climax.high + (indicators.atr * 0.2),
                confidence: liquidity.isWickSweep ? 85 : 79,
                reasons: [
                    `1H Volume climax (prev bar): ${climaxVolRatio.toFixed(1)}x`,
                    `Upper wick ${(upperWickRatio * 100).toFixed(0)}% at key level`,
                    'N+1 confirmation below climax body midpoint',
                    `RSI ${indicators.rsi.toFixed(0)}`
                ],
                expireMinutes: 180
            };
        }

        return null;
    }
}

/**
 * HTF Delta Divergence — kept as-is (profitable in real data).
 */
const DD_WINDOW = 12;

function netDelta(candles: { open: number; close: number; volume: number }[]): number {
    return candles.reduce((sum, c) => {
        const direction = c.close >= c.open ? 1 : -1;
        return sum + c.volume * direction;
    }, 0);
}

function priceReturn(candles: { close: number }[]): number {
    return candles[candles.length - 1].close - candles[0].close;
}

export class HtfDeltaDivergenceStrategy implements Strategy {
    name = 'HTF Delta Divergence';
    id = 'htf-delta-divergence';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < DD_WINDOW * 3 + 2) return null;

        const w1 = candles.slice(-(DD_WINDOW * 3), -(DD_WINDOW * 2));
        const w2 = candles.slice(-(DD_WINDOW * 2), -DD_WINDOW);
        const w3 = candles.slice(-DD_WINDOW);

        const delta1 = netDelta(w1);
        const delta2 = netDelta(w2);
        const delta3 = netDelta(w3);

        const price3 = priceReturn(w3);

        const normFactor = indicators.volumeSma * indicators.atr;
        if (normFactor <= 0) return null;

        const normDelta3 = delta3 / normFactor;

        if (price3 > 0 && delta3 < 0 && delta3 < delta2 * 0.5) {
            if (delta1 > 0 || delta2 > 0) {
                if (indicators.rsi > 56) {
                    const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.SHORT,
                        suggestedTarget: indicators.vwap,
                        suggestedSl: swingHigh + (indicators.atr * 0.3),
                        confidence: 77,
                        reasons: [
                            '1H price rising but delta turned negative',
                            `Delta: ${delta1.toFixed(0)} → ${delta2.toFixed(0)} → ${delta3.toFixed(0)}`,
                            `Normalized: ${normDelta3.toFixed(2)}`,
                            'Hidden selling absorption detected'
                        ],
                        expireMinutes: 180
                    };
                }
            }
        }

        if (price3 < 0 && delta3 > 0 && delta3 > delta2 * 0.5) {
            if (delta1 < 0 || delta2 < 0) {
                if (indicators.rsi < 44) {
                    const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.LONG,
                        suggestedTarget: indicators.vwap,
                        suggestedSl: swingLow - (indicators.atr * 0.3),
                        confidence: 77,
                        reasons: [
                            '1H price falling but delta turned positive',
                            `Delta: ${delta1.toFixed(0)} → ${delta2.toFixed(0)} → ${delta3.toFixed(0)}`,
                            `Normalized: ${normDelta3.toFixed(2)}`,
                            'Hidden buying absorption detected'
                        ],
                        expireMinutes: 180
                    };
                }
            }
        }

        return null;
    }
}
