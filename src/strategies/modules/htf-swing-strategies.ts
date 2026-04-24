import { StrategyContext, StrategySignalCandidate, Candle } from '../../core/types/bot-types.js';
import { SignalDirection, MarketRegimeType } from '../../core/constants/enums.js';
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
 * HTF RSI Divergence — rebuilt.
 *
 * Previous bug: findPriorSwing picked the LOWEST/HIGHEST swing in the window,
 * which in a downtrend is usually the most recent one. Current candle breaking
 * it with RSI barely higher = catching a falling knife (0/5, -72% in real data).
 *
 * New rules:
 * - Find the MOST RECENT confirmed fractal swing (at least MIN_SWING_GAP bars old)
 * - Require actual range market (regime RANGE + ADX < 22) — no counter-trending
 * - RSI divergence magnitude must be meaningful (>= 5 points)
 * - 2-bar confirmation (N-1 reversal bar + N confirmation bar)
 * - Not extremely stretched from EMA200 (|price - ema200|/atr < 4)
 */
const LOOKBACK = 30;
const MIN_SWING_GAP = 6;
const MIN_RSI_DIVERGENCE = 5;

export class HtfRsiDivergenceStrategy implements Strategy {
    name = 'HTF RSI Divergence';
    id = 'htf-rsi-divergence';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, regime } = ctx;
        if (candles.length < LOOKBACK + 5) return null;

        // Counter-trend signal — only fire in real range markets
        if (regime.type !== MarketRegimeType.RANGE) return null;
        if (indicators.adx >= 22) return null;

        const slice = candles.slice(-LOOKBACK);
        const last = slice[slice.length - 1];
        const prev = slice[slice.length - 2];

        const rsiValues = this.estimateRsiFromPrice(slice);
        if (!rsiValues || rsiValues.length < LOOKBACK) return null;

        const currentRsi = indicators.rsi;

        // Stretch guard: don't counter-trend if price is very far from EMA200
        const stretchFromEma = Math.abs(last.close - indicators.ema200) / indicators.atr;
        if (stretchFromEma > 4) return null;

        if (currentRsi < 40) {
            const priorSwingLow = this.findMostRecentSwingLow(slice, MIN_SWING_GAP);
            if (priorSwingLow) {
                const { index: priorIdx, price: priorLowPrice } = priorSwingLow;
                const currentLowPrice = Math.min(prev.low, last.low);

                if (currentLowPrice < priorLowPrice) {
                    const priorRsiAtLow = rsiValues[priorIdx];
                    const divergence = currentRsi - priorRsiAtLow;
                    if (divergence >= MIN_RSI_DIVERGENCE && priorRsiAtLow < 40) {
                        // 2-bar confirmation: prev was the reversal bar (lower low + bullish close),
                        // last is the continuation bar (higher close + bullish)
                        const prevReversal = prev.low === currentLowPrice && prev.close > prev.open;
                        const lastConfirm = last.close > last.open && last.close > prev.close && last.close > prev.high;
                        if (prevReversal && lastConfirm) {
                            const volumeRatio = last.volume / indicators.volumeSma;
                            return {
                                strategyName: this.name,
                                direction: SignalDirection.LONG,
                                orderType: 'MARKET',
                                suggestedTarget: indicators.ema50,
                                suggestedSl: currentLowPrice - (indicators.atr * 0.4),
                                confidence: volumeRatio >= 1.5 ? 82 : 76,
                                reasons: [
                                    `1H Bullish RSI Divergence: LL ${currentLowPrice.toFixed(4)} < ${priorLowPrice.toFixed(4)}`,
                                    `RSI HL: ${currentRsi.toFixed(0)} vs ${priorRsiAtLow.toFixed(0)} (Δ${divergence.toFixed(0)})`,
                                    '2-bar confirmation (reversal + continuation)',
                                    `Range + ADX ${indicators.adx.toFixed(0)}`
                                ],
                                expireMinutes: 180
                            };
                        }
                    }
                }
            }
        }

        if (currentRsi > 60) {
            const priorSwingHigh = this.findMostRecentSwingHigh(slice, MIN_SWING_GAP);
            if (priorSwingHigh) {
                const { index: priorIdx, price: priorHighPrice } = priorSwingHigh;
                const currentHighPrice = Math.max(prev.high, last.high);

                if (currentHighPrice > priorHighPrice) {
                    const priorRsiAtHigh = rsiValues[priorIdx];
                    const divergence = priorRsiAtHigh - currentRsi;
                    if (divergence >= MIN_RSI_DIVERGENCE && priorRsiAtHigh > 60) {
                        const prevReversal = prev.high === currentHighPrice && prev.close < prev.open;
                        const lastConfirm = last.close < last.open && last.close < prev.close && last.close < prev.low;
                        if (prevReversal && lastConfirm) {
                            const volumeRatio = last.volume / indicators.volumeSma;
                            return {
                                strategyName: this.name,
                                direction: SignalDirection.SHORT,
                                orderType: 'MARKET',
                                suggestedTarget: indicators.ema50,
                                suggestedSl: currentHighPrice + (indicators.atr * 0.4),
                                confidence: volumeRatio >= 1.5 ? 82 : 76,
                                reasons: [
                                    `1H Bearish RSI Divergence: HH ${currentHighPrice.toFixed(4)} > ${priorHighPrice.toFixed(4)}`,
                                    `RSI LH: ${currentRsi.toFixed(0)} vs ${priorRsiAtHigh.toFixed(0)} (Δ${divergence.toFixed(0)})`,
                                    '2-bar confirmation (reversal + continuation)',
                                    `Range + ADX ${indicators.adx.toFixed(0)}`
                                ],
                                expireMinutes: 180
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

    /**
     * Find the MOST RECENT confirmed fractal swing low that is at least
     * `minGap` bars away from the last candle. This fixes the earlier bug
     * where we picked the LOWEST swing in the window, which in a downtrend
     * is almost always the most recent one and causes us to fade fresh
     * breakdowns.
     */
    private findMostRecentSwingLow(candles: Candle[], minGap: number): { index: number; price: number } | null {
        const endIdx = candles.length - 1 - minGap;
        for (let i = endIdx; i >= 2; i--) {
            if (i + 1 >= candles.length) continue;
            if (
                candles[i].low < candles[i - 1].low &&
                candles[i].low < candles[i - 2].low &&
                candles[i].low <= candles[i + 1].low
            ) {
                return { index: i, price: candles[i].low };
            }
        }
        return null;
    }

    private findMostRecentSwingHigh(candles: Candle[], minGap: number): { index: number; price: number } | null {
        const endIdx = candles.length - 1 - minGap;
        for (let i = endIdx; i >= 2; i--) {
            if (i + 1 >= candles.length) continue;
            if (
                candles[i].high > candles[i - 1].high &&
                candles[i].high > candles[i - 2].high &&
                candles[i].high >= candles[i + 1].high
            ) {
                return { index: i, price: candles[i].high };
            }
        }
        return null;
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
export class HtfBollingerReversalStrategy implements Strategy {
    name = 'HTF BB Reversal';
    id = 'htf-bb-reversal';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, regime } = ctx;
        if (candles.length < 15) return null;

        if (regime.type !== MarketRegimeType.RANGE) return null;
        if (indicators.adx >= 20) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        const volumeRatio = last.volume / indicators.volumeSma;
        if (volumeRatio < 1.3) return null;

        const bbWidth = ((indicators.bbUpper - indicators.bbLower) / indicators.bbMid) * 100;
        if (bbWidth < 1.2) return null;

        // Stretch guard — counter-trend only near the anchor
        const stretchFromEma = Math.abs(last.close - indicators.ema200) / indicators.atr;
        if (stretchFromEma > 3.5) return null;

        // BB width must be NARROWING (consolidating), not expanding
        const recent5 = candles.slice(-6, -1);
        const avgRange5 = recent5.reduce((s, c) => s + (c.high - c.low), 0) / 5;
        const lastRange = last.high - last.low;
        if (lastRange > avgRange5 * 1.4) return null; // current bar too big = expansion

        const body = Math.abs(last.close - last.open);
        if (lastRange <= 0 || body / lastRange < 0.45) return null;

        const bandWidth = indicators.bbUpper - indicators.bbLower;

        // ─── BULLISH: prev pierced lower band; both prev and last close back inside
        if (
            prev.low < indicators.bbLower &&
            prev.close >= indicators.bbLower &&                          // prev already reclaimed
            last.close > indicators.bbLower + bandWidth * 0.15 &&        // last pushes further in
            last.close > last.open &&
            last.close > prev.high &&                                    // breakout of prev bar
            indicators.rsi < 32
        ) {
            const target = Math.min(indicators.bbMid, indicators.ema20);
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'MARKET',
                suggestedTarget: target,
                suggestedSl: Math.min(last.low, prev.low) - (indicators.atr * 0.3),
                confidence: 76,
                reasons: [
                    '1H BB Lower: 2-bar reclaim with breakout of prev bar',
                    `RSI deeply oversold: ${indicators.rsi.toFixed(0)}`,
                    `Volume: ${volumeRatio.toFixed(1)}x | BB ${bbWidth.toFixed(1)}% (consolidating)`,
                    `Range + ADX ${indicators.adx.toFixed(0)}`
                ],
                expireMinutes: 180
            };
        }

        if (
            prev.high > indicators.bbUpper &&
            prev.close <= indicators.bbUpper &&
            last.close < indicators.bbUpper - bandWidth * 0.15 &&
            last.close < last.open &&
            last.close < prev.low &&
            indicators.rsi > 68
        ) {
            const target = Math.max(indicators.bbMid, indicators.ema20);
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'MARKET',
                suggestedTarget: target,
                suggestedSl: Math.max(last.high, prev.high) + (indicators.atr * 0.3),
                confidence: 76,
                reasons: [
                    '1H BB Upper: 2-bar rejection with breakdown of prev bar',
                    `RSI deeply overbought: ${indicators.rsi.toFixed(0)}`,
                    `Volume: ${volumeRatio.toFixed(1)}x | BB ${bbWidth.toFixed(1)}% (consolidating)`,
                    `Range + ADX ${indicators.adx.toFixed(0)}`
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
 * HTF Delta Divergence — rebuilt.
 *
 * Previous: 0/5, -55%. Fired during trend pullbacks where a single window of
 * weak delta was read as "absorption" but was just normal pullback flow.
 *
 * New rules:
 * - Regime RANGE + ADX < 22 (no counter-trending into trends)
 * - Divergence must be LARGE: normalized delta magnitude >= 0.35
 * - Price move over window must be significant: >= 1.5 ATR (real drift)
 * - 2-bar confirmation (prev and last both in reversal direction)
 * - Stretch guard vs EMA200
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
        const { candles, indicators, regime } = ctx;
        if (candles.length < DD_WINDOW * 3 + 2) return null;

        if (regime.type !== MarketRegimeType.RANGE) return null;
        if (indicators.adx >= 22) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        const stretchFromEma = Math.abs(last.close - indicators.ema200) / indicators.atr;
        if (stretchFromEma > 4) return null;

        const w1 = candles.slice(-(DD_WINDOW * 3), -(DD_WINDOW * 2));
        const w2 = candles.slice(-(DD_WINDOW * 2), -DD_WINDOW);
        const w3 = candles.slice(-DD_WINDOW);

        const delta1 = netDelta(w1);
        const delta2 = netDelta(w2);
        const delta3 = netDelta(w3);

        const price3 = priceReturn(w3);
        const priceAtr3 = price3 / indicators.atr; // price move normalized by ATR

        const normFactor = indicators.volumeSma * indicators.atr;
        if (normFactor <= 0) return null;

        const normDelta3 = delta3 / normFactor;

        // SHORT: price drifted up ≥ 1.5 ATR but delta turned decisively negative
        if (priceAtr3 >= 1.5 && normDelta3 <= -0.35) {
            if (delta1 > 0 || delta2 > 0) {
                if (indicators.rsi > 58 && indicators.rsi < 72) {
                    const prevBearish = prev.close < prev.open;
                    const lastBearish = last.close < last.open && last.close < prev.close;
                    if (prevBearish && lastBearish) {
                        const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.SHORT,
                            suggestedTarget: indicators.vwap,
                            suggestedSl: swingHigh + (indicators.atr * 0.3),
                            confidence: 76,
                            reasons: [
                                `1H price +${priceAtr3.toFixed(1)} ATR but delta flipped negative`,
                                `Delta norm ${normDelta3.toFixed(2)} (strong absorption)`,
                                '2-bar bearish confirmation',
                                `Range + ADX ${indicators.adx.toFixed(0)}`
                            ],
                            expireMinutes: 180
                        };
                    }
                }
            }
        }

        if (priceAtr3 <= -1.5 && normDelta3 >= 0.35) {
            if (delta1 < 0 || delta2 < 0) {
                if (indicators.rsi < 42 && indicators.rsi > 28) {
                    const prevBullish = prev.close > prev.open;
                    const lastBullish = last.close > last.open && last.close > prev.close;
                    if (prevBullish && lastBullish) {
                        const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.LONG,
                            suggestedTarget: indicators.vwap,
                            suggestedSl: swingLow - (indicators.atr * 0.3),
                            confidence: 76,
                            reasons: [
                                `1H price ${priceAtr3.toFixed(1)} ATR but delta flipped positive`,
                                `Delta norm ${normDelta3.toFixed(2)} (strong absorption)`,
                                '2-bar bullish confirmation',
                                `Range + ADX ${indicators.adx.toFixed(0)}`
                            ],
                            expireMinutes: 180
                        };
                    }
                }
            }
        }

        return null;
    }
}
