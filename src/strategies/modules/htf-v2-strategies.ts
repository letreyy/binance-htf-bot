import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection, MarketRegimeType } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * HTF Funding Skew Reversal
 *
 * Extreme funding means one side is crowded — over-leveraged longs/shorts
 * get liquidated into a mean-reverting move. We wait for confirmation that
 * the crowded side is starting to flush.
 *
 * - |funding| >= 0.05% (8h rate) — genuine crowding
 * - RANGE regime + ADX < 22 (no strong directional trend to fight)
 * - Price stretched from VWAP by >= 1.5 ATR in the crowded direction
 * - Reversal candle (close against the crowd)
 */
export class HtfFundingSkewStrategy implements Strategy {
    name = 'HTF Funding Skew';
    id = 'htf-funding-skew';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, funding, regime } = ctx;
        if (!funding) return null;
        if (candles.length < 20) return null;

        if (regime.type !== MarketRegimeType.RANGE) return null;
        if (indicators.adx >= 22) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const fr = funding.rate; // fraction, e.g. 0.0005 = 0.05%

        if (Math.abs(fr) < 0.0005) return null;

        const stretch = (last.close - indicators.vwap) / indicators.atr;
        const volumeRatio = last.volume / indicators.volumeSma;

        // Longs crowded (positive funding) + price stretched above VWAP → fade long side
        if (fr > 0.0005 && stretch >= 1.5) {
            if (last.close < last.open && last.close < prev.close && volumeRatio >= 1.2) {
                const swingHigh = Math.max(prev.high, last.high);
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    orderType: 'MARKET',
                    suggestedTarget: indicators.vwap,
                    suggestedSl: swingHigh + (indicators.atr * 0.3),
                    confidence: 76,
                    reasons: [
                        `Funding +${(fr * 100).toFixed(3)}% — longs crowded`,
                        `Stretch ${stretch.toFixed(1)} ATR above VWAP`,
                        'Bearish reversal candle with volume',
                        `ADX ${indicators.adx.toFixed(0)} (range)`
                    ],
                    expireMinutes: 180
                };
            }
        }

        if (fr < -0.0005 && stretch <= -1.5) {
            if (last.close > last.open && last.close > prev.close && volumeRatio >= 1.2) {
                const swingLow = Math.min(prev.low, last.low);
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    orderType: 'MARKET',
                    suggestedTarget: indicators.vwap,
                    suggestedSl: swingLow - (indicators.atr * 0.3),
                    confidence: 76,
                    reasons: [
                        `Funding ${(fr * 100).toFixed(3)}% — shorts crowded`,
                        `Stretch ${stretch.toFixed(1)} ATR below VWAP`,
                        'Bullish reversal candle with volume',
                        `ADX ${indicators.adx.toFixed(0)} (range)`
                    ],
                    expireMinutes: 180
                };
            }
        }

        return null;
    }
}

/**
 * HTF Range Retest Continuation
 *
 * After a clean range breakout with volume, the former range boundary flips
 * from resistance to support (or vice versa). We enter on the first retest.
 *
 * - Price was in a tight range for >= 20 bars
 * - Breakout candle closed beyond range with body >= 50% of range, volume >= 1.6×
 * - Current candle retests the broken level (within 0.3 ATR) and bounces
 * - HTF trend (EMA200) aligned with breakout direction
 */
export class HtfRangeRetestStrategy implements Strategy {
    name = 'HTF Range Retest';
    id = 'htf-range-retest';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 35) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        // Find the breakout candle within the last 2-6 bars
        for (let offset = 2; offset <= 6; offset++) {
            const brk = candles[candles.length - 1 - offset];
            if (!brk) continue;

            const preRangeCandles = candles.slice(-1 - offset - 20, -1 - offset);
            if (preRangeCandles.length < 20) continue;

            const rangeHigh = Math.max(...preRangeCandles.map(c => c.high));
            const rangeLow = Math.min(...preRangeCandles.map(c => c.low));
            const rangeSize = rangeHigh - rangeLow;
            if (rangeSize <= 0) continue;

            // Range must be reasonably tight (< 5 ATR span)
            if (rangeSize > indicators.atr * 5) continue;

            const brkBody = Math.abs(brk.close - brk.open);
            const brkRange = brk.high - brk.low;
            if (brkRange <= 0 || brkBody / brkRange < 0.5) continue;

            const brkVol = brk.volume / indicators.volumeSma;
            if (brkVol < 1.6) continue;

            // ─── Bullish breakout ───
            if (
                brk.close > rangeHigh &&
                brk.close - rangeHigh > indicators.atr * 0.3 &&
                last.close > indicators.ema200
            ) {
                // Retest: current candle touched rangeHigh from above and closed above
                const touched = last.low <= rangeHigh + indicators.atr * 0.3 && last.low >= rangeHigh - indicators.atr * 0.2;
                if (touched && last.close > rangeHigh && last.close > last.open && last.close > prev.close) {
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.LONG,
                        orderType: 'MARKET',
                        suggestedTarget: brk.close + rangeSize,
                        suggestedSl: rangeHigh - (indicators.atr * 0.4),
                        confidence: 80,
                        reasons: [
                            `Range break: ${rangeLow.toFixed(4)} - ${rangeHigh.toFixed(4)} (${offset}h ago)`,
                            `Break volume: ${brkVol.toFixed(1)}x`,
                            'Retest holding as new support',
                            'Price above EMA200'
                        ],
                        expireMinutes: 240
                    };
                }
            }

            // ─── Bearish breakdown ───
            if (
                brk.close < rangeLow &&
                rangeLow - brk.close > indicators.atr * 0.3 &&
                last.close < indicators.ema200
            ) {
                const touched = last.high >= rangeLow - indicators.atr * 0.3 && last.high <= rangeLow + indicators.atr * 0.2;
                if (touched && last.close < rangeLow && last.close < last.open && last.close < prev.close) {
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.SHORT,
                        orderType: 'MARKET',
                        suggestedTarget: brk.close - rangeSize,
                        suggestedSl: rangeLow + (indicators.atr * 0.4),
                        confidence: 80,
                        reasons: [
                            `Range break: ${rangeLow.toFixed(4)} - ${rangeHigh.toFixed(4)} (${offset}h ago)`,
                            `Break volume: ${brkVol.toFixed(1)}x`,
                            'Retest rejecting as new resistance',
                            'Price below EMA200'
                        ],
                        expireMinutes: 240
                    };
                }
            }
        }

        return null;
    }
}

/**
 * HTF Wyckoff Spring / Upthrust
 *
 * Classic Wyckoff accumulation/distribution shakeout.
 *
 * Spring (LONG):
 *   - Range established for >= 15 bars
 *   - Price dips below range low (wick or close) on one candle
 *   - That candle closes back inside the range (upper 50% of its own body)
 *   - N+1 confirms with higher close than the spring candle
 *   - Volume on spring >= 1.5× (test of supply)
 *
 * Upthrust (SHORT): mirror image.
 */
export class HtfWyckoffSpringStrategy implements Strategy {
    name = 'HTF Wyckoff Spring';
    id = 'htf-wyckoff-spring';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, regime } = ctx;
        if (candles.length < 20) return null;

        // Works best in RANGE regime (accumulation/distribution phase)
        if (regime.type !== MarketRegimeType.RANGE) return null;

        const last = candles[candles.length - 1];
        const spring = candles[candles.length - 2];
        const rangeCandles = candles.slice(-17, -2);
        if (rangeCandles.length < 15) return null;

        const rangeHigh = Math.max(...rangeCandles.map(c => c.high));
        const rangeLow = Math.min(...rangeCandles.map(c => c.low));
        const rangeSize = rangeHigh - rangeLow;
        if (rangeSize <= 0) return null;
        if (rangeSize > indicators.atr * 6) return null; // too wide, not a range

        const springVol = spring.volume / indicators.volumeSma;

        // ─── Spring (LONG) ───
        const springedDown = spring.low < rangeLow;
        const closedBackInside = spring.close > rangeLow;
        const springBodyMid = (spring.open + spring.close) / 2;
        const closedUpperHalf = spring.close > springBodyMid || spring.close > spring.open;

        if (
            springedDown &&
            closedBackInside &&
            closedUpperHalf &&
            springVol >= 1.5 &&
            last.close > spring.close &&
            last.close > last.open &&
            indicators.rsi < 50
        ) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'MARKET',
                suggestedTarget: rangeHigh,
                suggestedSl: spring.low - (indicators.atr * 0.3),
                confidence: 82,
                reasons: [
                    `Wyckoff Spring: wicked ${((rangeLow - spring.low) / indicators.atr).toFixed(1)} ATR below range`,
                    `Closed back inside range (${rangeLow.toFixed(4)})`,
                    `Spring volume: ${springVol.toFixed(1)}x`,
                    'N+1 confirmation candle'
                ],
                expireMinutes: 240
            };
        }

        // ─── Upthrust (SHORT) ───
        const upthrusted = spring.high > rangeHigh;
        const closedBackInsideUp = spring.close < rangeHigh;
        const closedLowerHalf = spring.close < springBodyMid || spring.close < spring.open;

        if (
            upthrusted &&
            closedBackInsideUp &&
            closedLowerHalf &&
            springVol >= 1.5 &&
            last.close < spring.close &&
            last.close < last.open &&
            indicators.rsi > 50
        ) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'MARKET',
                suggestedTarget: rangeLow,
                suggestedSl: spring.high + (indicators.atr * 0.3),
                confidence: 82,
                reasons: [
                    `Wyckoff Upthrust: wicked ${((spring.high - rangeHigh) / indicators.atr).toFixed(1)} ATR above range`,
                    `Closed back inside range (${rangeHigh.toFixed(4)})`,
                    `Upthrust volume: ${springVol.toFixed(1)}x`,
                    'N+1 confirmation candle'
                ],
                expireMinutes: 240
            };
        }

        return null;
    }
}

/**
 * HTF Open Interest Divergence
 *
 * Rising OI during a price stall or counter move = new positions entering
 * the losing side (trapped). When OI spikes and price diverges from it,
 * the trapped side eventually unwinds — we fade the trapped crowd.
 *
 * - OI history available (30 bars of 1h data)
 * - OI rose >= 6% in last 5 bars
 * - Price over that window is either flat (<1 ATR change) or counter-move
 * - Confirmation candle in the direction of the expected unwind
 */
export class HtfOpenInterestDivergenceStrategy implements Strategy {
    name = 'HTF OI Divergence';
    id = 'htf-oi-divergence';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, openInterest } = ctx;
        if (!openInterest || openInterest.oiHistory.length < 10) return null;
        if (candles.length < 10) return null;

        const oiHist = openInterest.oiHistory;
        const oiNow = openInterest.oi;
        const oi5Ago = oiHist[oiHist.length - 5];
        if (!oi5Ago || oi5Ago <= 0) return null;

        const oiDeltaPct = ((oiNow - oi5Ago) / oi5Ago) * 100;
        if (Math.abs(oiDeltaPct) < 6) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const ref = candles[candles.length - 6];
        if (!ref) return null;

        const priceChange = last.close - ref.close;
        const priceChangeAtr = priceChange / indicators.atr;

        // OI rising + price flat/counter-rising ← trapped longs (price didn't follow OI up)
        if (oiDeltaPct >= 6) {
            // Case A: price rose but weakly (1-2 ATR) AND near resistance → trapped longs
            // Case B: price actually fell while OI rose → definitely trapped longs
            const priceRoseWeakly = priceChangeAtr > 0 && priceChangeAtr < 1.5;
            const pricefell = priceChangeAtr < -0.3;

            if ((priceRoseWeakly || pricefell) && last.close < last.open && last.close < prev.close) {
                if (indicators.rsi > 55 || pricefell) {
                    const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.SHORT,
                        orderType: 'MARKET',
                        suggestedTarget: indicators.vwap,
                        suggestedSl: swingHigh + (indicators.atr * 0.4),
                        confidence: 78,
                        reasons: [
                            `OI +${oiDeltaPct.toFixed(1)}% in 5h`,
                            `Price ${priceChangeAtr.toFixed(1)} ATR — divergence vs OI`,
                            'Trapped longs — bearish reversal candle',
                            `RSI ${indicators.rsi.toFixed(0)}`
                        ],
                        expireMinutes: 180
                    };
                }
            }
        }

        // OI falling while price rising = shorts covering — trend continuation (LONG)
        // OI falling while price falling = longs capitulating — reversal LONG opportunity
        if (oiDeltaPct <= -6) {
            const priceFellWeakly = priceChangeAtr < 0 && priceChangeAtr > -1.5;
            const priceRose = priceChangeAtr > 0.3;

            if ((priceFellWeakly || priceRose) && last.close > last.open && last.close > prev.close) {
                if (indicators.rsi < 45 || priceRose) {
                    const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.LONG,
                        orderType: 'MARKET',
                        suggestedTarget: indicators.vwap,
                        suggestedSl: swingLow - (indicators.atr * 0.4),
                        confidence: 78,
                        reasons: [
                            `OI ${oiDeltaPct.toFixed(1)}% in 5h`,
                            `Price ${priceChangeAtr.toFixed(1)} ATR — unwind detected`,
                            'Trapped shorts / capitulation — bullish reversal',
                            `RSI ${indicators.rsi.toFixed(0)}`
                        ],
                        expireMinutes: 180
                    };
                }
            }
        }

        return null;
    }
}
