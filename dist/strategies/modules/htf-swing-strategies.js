import { SignalDirection } from '../../core/constants/enums.js';
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
export class HtfEmaPullbackStrategy {
    name = 'HTF EMA Pullback';
    id = 'htf-ema-pullback';
    execute(ctx) {
        const { candles, indicators } = ctx;
        if (candles.length < 10)
            return null;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        if (indicators.adx < 25)
            return null;
        const body = Math.abs(last.close - last.open);
        const range = last.high - last.low;
        if (range <= 0 || body / range < 0.4)
            return null;
        const touchEma20 = Math.abs(last.low - indicators.ema20) < indicators.atr * 0.3;
        const touchEma50 = Math.abs(last.low - indicators.ema50) < indicators.atr * 0.3;
        const touchHighEma20 = Math.abs(last.high - indicators.ema20) < indicators.atr * 0.3;
        const touchHighEma50 = Math.abs(last.high - indicators.ema50) < indicators.atr * 0.3;
        // ─── BULLISH pullback ───
        if (indicators.ema20 > indicators.ema50 &&
            indicators.ema50 > indicators.ema200 &&
            last.close > last.open &&
            (touchEma20 || touchEma50) &&
            indicators.rsi > 40 && indicators.rsi < 65) {
            const emaRef = touchEma20 ? indicators.ema20 : indicators.ema50;
            const swingLow = Math.min(last.low, prev.low);
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'MARKET',
                suggestedTarget: ctx.liquidity.localRangeHigh || (last.close + indicators.atr * 3),
                suggestedSl: swingLow - (indicators.atr * 0.3),
                confidence: 80,
                reasons: [
                    `1H bullish pullback to EMA${touchEma20 ? '20' : '50'} (${emaRef.toFixed(4)})`,
                    `ADX: ${indicators.adx.toFixed(0)} — confirmed uptrend`,
                    'Bullish confirmation candle on EMA bounce',
                    'EMA stack: 20 > 50 > 200'
                ],
                expireMinutes: 240
            };
        }
        // ─── BEARISH pullback ───
        if (indicators.ema20 < indicators.ema50 &&
            indicators.ema50 < indicators.ema200 &&
            last.close < last.open &&
            (touchHighEma20 || touchHighEma50) &&
            indicators.rsi > 35 && indicators.rsi < 60) {
            const emaRef = touchHighEma20 ? indicators.ema20 : indicators.ema50;
            const swingHigh = Math.max(last.high, prev.high);
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'MARKET',
                suggestedTarget: ctx.liquidity.localRangeLow || (last.close - indicators.atr * 3),
                suggestedSl: swingHigh + (indicators.atr * 0.3),
                confidence: 80,
                reasons: [
                    `1H bearish pullback to EMA${touchHighEma20 ? '20' : '50'} (${emaRef.toFixed(4)})`,
                    `ADX: ${indicators.adx.toFixed(0)} — confirmed downtrend`,
                    'Bearish confirmation candle on EMA rejection',
                    'EMA stack: 20 < 50 < 200'
                ],
                expireMinutes: 240
            };
        }
        return null;
    }
}
/**
 * HTF RSI Divergence — adapted for 1H
 *
 * RSI divergences on 1H are MUCH more reliable than on 15m.
 * - Wider lookback (30 candles = 30 hours)
 * - Min swing gap: 8 candles
 * - Relaxed RSI thresholds for 1H (< 40 / > 60)
 * - Expiry: 4h
 */
const LOOKBACK = 30;
const MIN_SWING_GAP = 8;
export class HtfRsiDivergenceStrategy {
    name = 'HTF RSI Divergence';
    id = 'htf-rsi-divergence';
    execute(ctx) {
        const { candles, indicators } = ctx;
        if (candles.length < LOOKBACK + 5)
            return null;
        const slice = candles.slice(-LOOKBACK);
        const last = slice[slice.length - 1];
        const rsiValues = this.estimateRsiFromPrice(slice);
        if (!rsiValues || rsiValues.length < LOOKBACK)
            return null;
        const currentRsi = indicators.rsi;
        // ─── Bullish Divergence ───
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
        // ─── Bearish Divergence ───
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
    estimateRsiFromPrice(candles) {
        const period = 14;
        if (candles.length < period + 1)
            return [];
        const rsiValues = new Array(candles.length).fill(50);
        let avgGain = 0;
        let avgLoss = 0;
        for (let i = 1; i <= period; i++) {
            const change = candles[i].close - candles[i - 1].close;
            if (change > 0)
                avgGain += change;
            else
                avgLoss += Math.abs(change);
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
    findPriorSwingLow(candles, minGap) {
        const endIdx = candles.length - 1 - minGap;
        let lowestIdx = -1;
        let lowestPrice = Infinity;
        for (let i = 2; i <= endIdx; i++) {
            if (candles[i].low < candles[i - 1].low &&
                candles[i].low < candles[i - 2].low &&
                i + 1 < candles.length &&
                candles[i].low <= candles[i + 1].low) {
                if (candles[i].low < lowestPrice) {
                    lowestPrice = candles[i].low;
                    lowestIdx = i;
                }
            }
        }
        if (lowestIdx === -1)
            return null;
        return { index: lowestIdx, price: lowestPrice };
    }
    findPriorSwingHigh(candles, minGap) {
        const endIdx = candles.length - 1 - minGap;
        let highestIdx = -1;
        let highestPrice = -Infinity;
        for (let i = 2; i <= endIdx; i++) {
            if (candles[i].high > candles[i - 1].high &&
                candles[i].high > candles[i - 2].high &&
                i + 1 < candles.length &&
                candles[i].high >= candles[i + 1].high) {
                if (candles[i].high > highestPrice) {
                    highestPrice = candles[i].high;
                    highestIdx = i;
                }
            }
        }
        if (highestIdx === -1)
            return null;
        return { index: highestIdx, price: highestPrice };
    }
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
export class HtfEmaCrossMomentumStrategy {
    name = 'HTF EMA Cross';
    id = 'htf-ema-cross';
    execute(ctx) {
        const { candles, indicators, prevIndicators } = ctx;
        if (candles.length < 5)
            return null;
        const last = candles[candles.length - 1];
        const currEma20 = indicators.ema20;
        const currEma50 = indicators.ema50;
        const prevEma20 = prevIndicators.ema20;
        const prevEma50 = prevIndicators.ema50;
        if (indicators.adx < 22)
            return null;
        const volumeRatio = last.volume / indicators.volumeSma;
        if (volumeRatio < 1.3)
            return null;
        // Golden cross
        if (currEma20 > currEma50 && prevEma20 <= prevEma50) {
            if (last.close > indicators.ema200) {
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
                        'Price above EMA200'
                    ],
                    expireMinutes: 240
                };
            }
        }
        // Death cross
        if (currEma20 < currEma50 && prevEma20 >= prevEma50) {
            if (last.close < indicators.ema200) {
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
                        'Price below EMA200'
                    ],
                    expireMinutes: 240
                };
            }
        }
        return null;
    }
}
/**
 * HTF Bollinger Band Reversal — adapted for 1H
 *
 * BB reversals on 1H are more reliable than 15m.
 * - BB width check: > 1.0% (vs 0.8% on 15m)
 * - Volume: > 1.2× (vs 1.3 on 15m — 1H already has volume aggregated)
 * - Expiry: 3h
 */
export class HtfBollingerReversalStrategy {
    name = 'HTF BB Reversal';
    id = 'htf-bb-reversal';
    execute(ctx) {
        const { candles, indicators } = ctx;
        if (candles.length < 3)
            return null;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const volumeRatio = last.volume / indicators.volumeSma;
        if (volumeRatio < 1.2)
            return null;
        const bbWidth = ((indicators.bbUpper - indicators.bbLower) / indicators.bbMid) * 100;
        if (bbWidth < 1.0)
            return null;
        // Bullish
        if (prev.low < indicators.bbLower &&
            last.close > indicators.bbLower &&
            last.close > last.open &&
            indicators.rsi < 38) {
            const bodySize = Math.abs(last.close - last.open);
            const fullRange = last.high - last.low;
            const isPinBar = fullRange > 0 && bodySize / fullRange < 0.35;
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'MARKET',
                suggestedTarget: indicators.bbMid,
                suggestedSl: Math.min(last.low, prev.low) - (indicators.atr * 0.2),
                confidence: isPinBar ? 83 : 77,
                reasons: [
                    '1H BB Lower Band rejection',
                    `RSI oversold: ${indicators.rsi.toFixed(0)}`,
                    `Volume: ${volumeRatio.toFixed(1)}x avg`,
                    `BB Width: ${bbWidth.toFixed(1)}%`,
                    isPinBar ? 'Pin bar confirmation' : 'Bullish candle confirmation'
                ],
                expireMinutes: 180
            };
        }
        // Bearish
        if (prev.high > indicators.bbUpper &&
            last.close < indicators.bbUpper &&
            last.close < last.open &&
            indicators.rsi > 62) {
            const bodySize = Math.abs(last.close - last.open);
            const fullRange = last.high - last.low;
            const isPinBar = fullRange > 0 && bodySize / fullRange < 0.35;
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'MARKET',
                suggestedTarget: indicators.bbMid,
                suggestedSl: Math.max(last.high, prev.high) + (indicators.atr * 0.2),
                confidence: isPinBar ? 83 : 77,
                reasons: [
                    '1H BB Upper Band rejection',
                    `RSI overbought: ${indicators.rsi.toFixed(0)}`,
                    `Volume: ${volumeRatio.toFixed(1)}x avg`,
                    `BB Width: ${bbWidth.toFixed(1)}%`,
                    isPinBar ? 'Pin bar confirmation' : 'Bearish candle confirmation'
                ],
                expireMinutes: 180
            };
        }
        return null;
    }
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
export class HtfVolumeClimaxStrategy {
    name = 'HTF Volume Climax';
    id = 'htf-volume-climax';
    execute(ctx) {
        const { candles, indicators, liquidity } = ctx;
        if (candles.length < 12)
            return null;
        const last = candles[candles.length - 1];
        const fullRange = last.high - last.low;
        if (fullRange <= 0)
            return null;
        const volumeRatio = last.volume / indicators.volumeSma;
        if (volumeRatio < 2.5)
            return null;
        const bodyTop = Math.max(last.open, last.close);
        const bodyBot = Math.min(last.open, last.close);
        const upperWick = last.high - bodyTop;
        const lowerWick = bodyBot - last.low;
        const upperWickRatio = upperWick / fullRange;
        const lowerWickRatio = lowerWick / fullRange;
        const priorCandles = candles.slice(-9, -1);
        let bearCount = 0;
        let bullCount = 0;
        for (const c of priorCandles) {
            if (c.close < c.open)
                bearCount++;
            else if (c.close > c.open)
                bullCount++;
        }
        // Bullish
        if (lowerWickRatio >= 0.50 &&
            bearCount >= 4 &&
            indicators.rsi < 40) {
            let confidence = 79;
            const reasons = [
                `1H Volume Climax: ${volumeRatio.toFixed(1)}x avg`,
                `Lower wick: ${(lowerWickRatio * 100).toFixed(0)}% of range`,
                `${bearCount}/8 prior candles bearish`,
                `RSI oversold: ${indicators.rsi.toFixed(0)}`
            ];
            if (liquidity.sweptLow && liquidity.isWickSweep) {
                confidence += 5;
                reasons.push('Liquidity sweep confirmed');
            }
            if (volumeRatio >= 4.0) {
                confidence += 5;
                reasons.push(`Extreme volume: ${volumeRatio.toFixed(1)}x`);
            }
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'MARKET',
                suggestedSl: last.low - (indicators.atr * 0.2),
                confidence: Math.min(confidence, 92),
                reasons,
                expireMinutes: 180
            };
        }
        // Bearish
        if (upperWickRatio >= 0.50 &&
            bullCount >= 4 &&
            indicators.rsi > 60) {
            let confidence = 79;
            const reasons = [
                `1H Volume Climax: ${volumeRatio.toFixed(1)}x avg`,
                `Upper wick: ${(upperWickRatio * 100).toFixed(0)}% of range`,
                `${bullCount}/8 prior candles bullish`,
                `RSI overbought: ${indicators.rsi.toFixed(0)}`
            ];
            if (liquidity.sweptHigh && liquidity.isWickSweep) {
                confidence += 5;
                reasons.push('Liquidity sweep confirmed');
            }
            if (volumeRatio >= 4.0) {
                confidence += 5;
                reasons.push(`Extreme volume: ${volumeRatio.toFixed(1)}x`);
            }
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'MARKET',
                suggestedSl: last.high + (indicators.atr * 0.2),
                confidence: Math.min(confidence, 92),
                reasons,
                expireMinutes: 180
            };
        }
        return null;
    }
}
/**
 * HTF Delta Divergence — adapted for 1H
 *
 * Delta (CVD proxy) divergence on 1H captures institutional footprints.
 * - Window: 12 candles (12 hours per window)
 * - RSI gating: 56/44 (relaxed vs 58/42 on 15m)
 * - Expiry: 3h
 */
const DD_WINDOW = 12;
function netDelta(candles) {
    return candles.reduce((sum, c) => {
        const direction = c.close >= c.open ? 1 : -1;
        return sum + c.volume * direction;
    }, 0);
}
function priceReturn(candles) {
    return candles[candles.length - 1].close - candles[0].close;
}
export class HtfDeltaDivergenceStrategy {
    name = 'HTF Delta Divergence';
    id = 'htf-delta-divergence';
    execute(ctx) {
        const { candles, indicators } = ctx;
        if (candles.length < DD_WINDOW * 3 + 2)
            return null;
        const w1 = candles.slice(-(DD_WINDOW * 3), -(DD_WINDOW * 2));
        const w2 = candles.slice(-(DD_WINDOW * 2), -DD_WINDOW);
        const w3 = candles.slice(-DD_WINDOW);
        const delta1 = netDelta(w1);
        const delta2 = netDelta(w2);
        const delta3 = netDelta(w3);
        const price3 = priceReturn(w3);
        const normFactor = indicators.volumeSma * indicators.atr;
        if (normFactor <= 0)
            return null;
        const normDelta3 = delta3 / normFactor;
        // Bearish divergence
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
        // Bullish divergence
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
//# sourceMappingURL=htf-swing-strategies.js.map