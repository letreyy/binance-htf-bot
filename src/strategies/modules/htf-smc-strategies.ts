import { StrategyContext, StrategySignalCandidate, Candle } from '../../core/types/bot-types.js';
import { SignalDirection, MarketRegimeType } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * HTF Order Block Retest — profitable in real data (2W/1L). Kept logic, tightened volume.
 */
export class HtfOrderBlockStrategy implements Strategy {
    name = 'HTF Order Block';
    id = 'htf-order-block';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 60) return null;

        const LOOKBACK = 24;

        for (let i = candles.length - 1; i >= candles.length - LOOKBACK; i--) {
            const current = candles[i];
            const prev1 = candles[i - 1];
            const prev2 = candles[i - 2];
            if (!prev1 || !prev2) continue;

            const isBullImpulse =
                current.close > current.open &&
                prev1.close > prev1.open &&
                (current.close - prev1.open) > (indicators.atr * 2.2) &&
                current.volume > indicators.volumeSma * 1.5;

            if (isBullImpulse && prev2.close < prev2.open) {
                const obHigh = prev2.high;

                let unmitigated = true;
                for (let j = i + 1; j < candles.length; j++) {
                    if (candles[j].low <= obHigh) {
                        unmitigated = false;
                        break;
                    }
                }

                if (unmitigated) {
                    const lastPrice = candles[candles.length - 1].close;
                    if (lastPrice > obHigh && lastPrice < obHigh * 1.025) {
                        const obLow = prev2.low;
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.LONG,
                            orderType: 'LIMIT',
                            suggestedEntry: obHigh,
                            suggestedTarget: ctx.liquidity.localRangeHigh || (obHigh + (obHigh - obLow) * 3),
                            suggestedSl: obLow - (indicators.atr * 0.3),
                            confidence: 82,
                            reasons: [
                                `1H Bullish Order Block at ${obHigh.toFixed(4)}`,
                                'Unmitigated OB — price approaching for retest',
                                'HTF structure: institutional footprint'
                            ],
                            expireMinutes: 60 * 24
                        };
                    }
                }
            }

            const isBearImpulse =
                current.close < current.open &&
                prev1.close < prev1.open &&
                (prev1.open - current.close) > (indicators.atr * 2.2) &&
                current.volume > indicators.volumeSma * 1.5;

            if (isBearImpulse && prev2.close > prev2.open) {
                const obLow = prev2.low;

                let unmitigated = true;
                for (let j = i + 1; j < candles.length; j++) {
                    if (candles[j].high >= obLow) {
                        unmitigated = false;
                        break;
                    }
                }

                if (unmitigated) {
                    const lastPrice = candles[candles.length - 1].close;
                    if (lastPrice < obLow && lastPrice > obLow * 0.975) {
                        const obHigh = prev2.high;
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.SHORT,
                            orderType: 'LIMIT',
                            suggestedEntry: obLow,
                            suggestedTarget: ctx.liquidity.localRangeLow || (obLow - (obHigh - obLow) * 3),
                            suggestedSl: obHigh + (indicators.atr * 0.3),
                            confidence: 82,
                            reasons: [
                                `1H Bearish Order Block at ${obLow.toFixed(4)}`,
                                'Unmitigated OB — price approaching for retest',
                                'HTF structure: distribution zone'
                            ],
                            expireMinutes: 60 * 24
                        };
                    }
                }
            }
        }

        return null;
    }
}

/**
 * HTF Fair Value Gap — rebuilt (round 2).
 *
 * Last round: tightened but still 0/4 -30%. Problems found:
 *   - rsi < 70 / rsi > 30 way too lax for trend entries → caught late pops
 *   - `ema50 > ema200` alone is a dead-cat-trend filter (bounce in downtrend
 *     can satisfy it briefly). Need full stack `ema20 > ema50 > ema200`.
 *   - 4H alignment was optional; now required.
 *   - Max age 36 → 24h (older FVGs are stale).
 *   - 3% past-FVG cap → 1.5% (less chasing).
 */
const FVG_LOOKBACK = 72;
const FVG_MIN_SIZE_PCT = 0.35;
const FVG_VOLUME_MULTIPLIER = 1.8;

interface FVGZone {
    top: number;
    bottom: number;
    midpoint: number;
    direction: 'BULLISH' | 'BEARISH';
    strength: number;
    candleIdx: number;
    volumeStrength: number;
    partiallyFilled: boolean;
    fullyTouched: boolean;
}

function findFVGs(candles: Candle[], avgVolume: number): FVGZone[] {
    const zones: FVGZone[] = [];
    const start = Math.max(1, candles.length - FVG_LOOKBACK);
    const end = candles.length - 2;

    for (let i = start; i < end; i++) {
        const c0 = candles[i - 1];
        const c1 = candles[i];
        const c2 = candles[i + 1];

        const midPrice = c1.close;
        const minSize = midPrice * (FVG_MIN_SIZE_PCT / 100);
        const volStrength = c1.volume / (avgVolume || 1);

        if (volStrength < FVG_VOLUME_MULTIPLIER) continue;

        if (c2.low > c0.high) {
            const gapSize = c2.low - c0.high;
            if (gapSize >= minSize) {
                const top = c2.low;
                const bottom = c0.high;
                const midpoint = (top + bottom) / 2;
                const partiallyFilled = candles.slice(i + 2).some(c => c.low < midpoint);
                const fullyTouched = candles.slice(i + 2).some(c => c.low <= bottom);
                zones.push({ top, bottom, midpoint, direction: 'BULLISH', strength: (gapSize / midPrice) * 100, candleIdx: i, volumeStrength: volStrength, partiallyFilled, fullyTouched });
            }
        }

        if (c0.low > c2.high) {
            const gapSize = c0.low - c2.high;
            if (gapSize >= minSize) {
                const top = c0.low;
                const bottom = c2.high;
                const midpoint = (top + bottom) / 2;
                const partiallyFilled = candles.slice(i + 2).some(c => c.high > midpoint);
                const fullyTouched = candles.slice(i + 2).some(c => c.high >= top);
                zones.push({ top, bottom, midpoint, direction: 'BEARISH', strength: (gapSize / midPrice) * 100, candleIdx: i, volumeStrength: volStrength, partiallyFilled, fullyTouched });
            }
        }
    }

    return zones;
}

export class HtfFairValueGapStrategy implements Strategy {
    name = 'HTF Fair Value Gap';
    id = 'htf-fvg';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < FVG_LOOKBACK + 5) return null;

        const last = candles[candles.length - 1];
        const currentPrice = last.close;

        const fvgZones = findFVGs(candles, indicators.volumeSma);
        if (fvgZones.length === 0) return null;

        // 4H alignment: require 4H close in trend direction
        let htf4hBullish: boolean | null = null;
        if (ctx.candles4h && ctx.candles4h.length > 0) {
            const htf = ctx.candles4h[ctx.candles4h.length - 1];
            htf4hBullish = htf.close > htf.open;
        }

        const currentIdx = candles.length - 1;

        // 4H alignment is now REQUIRED — no ambiguous/null trades
        if (htf4hBullish === null) return null;

        for (const zone of fvgZones) {
            const age = currentIdx - zone.candleIdx;

            if (age < 2 || age > 24) continue;
            if (zone.partiallyFilled) continue;

            if (zone.direction === 'BULLISH' && currentPrice > zone.midpoint) {
                // Full EMA stack required
                if (!(indicators.ema20 > indicators.ema50 && indicators.ema50 > indicators.ema200)) continue;
                if (indicators.rsi > 62) continue; // no chasing late extensions
                if ((currentPrice - zone.top) / zone.top > 0.015) continue; // tightened
                if (!htf4hBullish) continue;

                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    orderType: 'LIMIT',
                    suggestedEntry: zone.midpoint,
                    suggestedTarget: ctx.liquidity.localRangeHigh || (zone.top + (zone.top - zone.bottom) * 3),
                    suggestedSl: zone.bottom - (indicators.atr * 0.3),
                    confidence: 82,
                    reasons: [
                        `1H Bullish FVG: ${zone.bottom.toFixed(4)}–${zone.top.toFixed(4)}`,
                        `Equilibrium entry: ${zone.midpoint.toFixed(4)}`,
                        `Gap: ${zone.strength.toFixed(2)}% | Vol: ${zone.volumeStrength.toFixed(1)}x`,
                        `Age: ${age}h | 4H bullish + full EMA stack`
                    ],
                    expireMinutes: 60 * 12
                };
            }

            if (zone.direction === 'BEARISH' && currentPrice < zone.midpoint) {
                if (!(indicators.ema20 < indicators.ema50 && indicators.ema50 < indicators.ema200)) continue;
                if (indicators.rsi < 38) continue;
                if ((zone.bottom - currentPrice) / zone.bottom > 0.015) continue;
                if (htf4hBullish) continue;

                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    orderType: 'LIMIT',
                    suggestedEntry: zone.midpoint,
                    suggestedTarget: ctx.liquidity.localRangeLow || (zone.bottom - (zone.top - zone.bottom) * 3),
                    suggestedSl: zone.top + (indicators.atr * 0.3),
                    confidence: 82,
                    reasons: [
                        `1H Bearish FVG: ${zone.bottom.toFixed(4)}–${zone.top.toFixed(4)}`,
                        `Equilibrium entry: ${zone.midpoint.toFixed(4)}`,
                        `Gap: ${zone.strength.toFixed(2)}% | Vol: ${zone.volumeStrength.toFixed(1)}x`,
                        `Age: ${age}h | 4H bearish + full EMA stack`
                    ],
                    expireMinutes: 60 * 12
                };
            }
        }

        return null;
    }
}

/**
 * HTF OB Magnet — heavily restricted. Previous: 0/2, -26%.
 * Only fires in RANGE regime with ADX<18 and RSI extreme.
 */
export class HtfObMagnetStrategy implements Strategy {
    name = 'HTF OB Magnet';
    id = 'htf-ob-magnet';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, regime } = ctx;
        if (candles.length < 60) return null;
        if (regime.type !== MarketRegimeType.RANGE) return null;
        if (indicators.adx >= 18) return null;

        const LOOKBACK = 24;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const currentPrice = last.close;

        for (let i = candles.length - 1; i >= candles.length - LOOKBACK; i--) {
            const current = candles[i];
            const prev1 = candles[i - 1];
            const prev2 = candles[i - 2];
            if (!prev1 || !prev2) continue;

            const isBullImpulse =
                current.close > current.open &&
                prev1.close > prev1.open &&
                (current.close - prev1.open) > (indicators.atr * 2.0);

            if (isBullImpulse && prev2.close < prev2.open) {
                const obHigh = prev2.high;

                let unmitigated = true;
                for (let j = i + 1; j < candles.length; j++) {
                    if (candles[j].low <= obHigh) {
                        unmitigated = false; break;
                    }
                }

                if (unmitigated && currentPrice > obHigh + (indicators.atr * 1.5) && indicators.rsi > 78) {
                    if (last.close < last.open && last.close < indicators.ema20 && prev.close > prev.open) {
                        const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.SHORT,
                            orderType: 'MARKET',
                            suggestedEntry: currentPrice,
                            suggestedTarget: obHigh,
                            suggestedSl: swingHigh + (indicators.atr * 0.4),
                            confidence: 74,
                            reasons: [
                                `Magnet: RANGE regime, RSI extreme ${indicators.rsi.toFixed(0)}`,
                                `Price drawn to Bullish OB at ${obHigh.toFixed(4)}`,
                                'Shorting exhaustion pullback'
                            ],
                            expireMinutes: 120
                        };
                    }
                }
            }

            const isBearImpulse =
                current.close < current.open &&
                prev1.close < prev1.open &&
                (prev1.open - current.close) > (indicators.atr * 2.0);

            if (isBearImpulse && prev2.close > prev2.open) {
                const obLow = prev2.low;

                let unmitigated = true;
                for (let j = i + 1; j < candles.length; j++) {
                    if (candles[j].high >= obLow) {
                        unmitigated = false; break;
                    }
                }

                if (unmitigated && currentPrice < obLow - (indicators.atr * 1.5) && indicators.rsi < 22) {
                    if (last.close > last.open && last.close > indicators.ema20 && prev.close < prev.open) {
                        const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.LONG,
                            orderType: 'MARKET',
                            suggestedEntry: currentPrice,
                            suggestedTarget: obLow,
                            suggestedSl: swingLow - (indicators.atr * 0.4),
                            confidence: 74,
                            reasons: [
                                `Magnet: RANGE regime, RSI extreme ${indicators.rsi.toFixed(0)}`,
                                `Price drawn to Bearish OB at ${obLow.toFixed(4)}`,
                                'Longing exhaustion pullback'
                            ],
                            expireMinutes: 120
                        };
                    }
                }
            }
        }
        return null;
    }
}

/**
 * HTF FVG Magnet — heavily restricted. Previous: 0/2, -57%.
 * Only fires in RANGE regime with ADX<18 and RSI extreme.
 */
export class HtfFvgMagnetStrategy implements Strategy {
    name = 'HTF FVG Magnet';
    id = 'htf-fvg-magnet';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, regime } = ctx;
        if (candles.length < FVG_LOOKBACK + 5) return null;
        if (regime.type !== MarketRegimeType.RANGE) return null;
        if (indicators.adx >= 18) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const currentPrice = last.close;

        const fvgZones = findFVGs(candles, indicators.volumeSma);
        if (fvgZones.length === 0) return null;

        const currentIdx = candles.length - 1;

        for (const zone of fvgZones) {
            const age = currentIdx - zone.candleIdx;
            if (age < 2 || age > 36 || zone.partiallyFilled) continue;

            if (zone.direction === 'BULLISH' && currentPrice > zone.midpoint && indicators.rsi > 78) {
                if (currentPrice > zone.top + (indicators.atr * 1.5)) {
                    if (last.close < last.open && last.close < indicators.ema20 && prev.close > prev.open) {
                        const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.SHORT,
                            orderType: 'MARKET',
                            suggestedEntry: currentPrice,
                            suggestedTarget: zone.midpoint,
                            suggestedSl: swingHigh + (indicators.atr * 0.4),
                            confidence: 75,
                            reasons: [
                                `Magnet: RANGE + RSI ${indicators.rsi.toFixed(0)}`,
                                `Drawn to Bullish FVG ${zone.top.toFixed(4)}`,
                                'Bearish momentum confirmation'
                            ],
                            expireMinutes: 120
                        };
                    }
                }
            }

            if (zone.direction === 'BEARISH' && currentPrice < zone.midpoint && indicators.rsi < 22) {
                if (currentPrice < zone.bottom - (indicators.atr * 1.5)) {
                    if (last.close > last.open && last.close > indicators.ema20 && prev.close < prev.open) {
                        const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.LONG,
                            orderType: 'MARKET',
                            suggestedEntry: currentPrice,
                            suggestedTarget: zone.midpoint,
                            suggestedSl: swingLow - (indicators.atr * 0.4),
                            confidence: 75,
                            reasons: [
                                `Magnet: RANGE + RSI ${indicators.rsi.toFixed(0)}`,
                                `Drawn to Bearish FVG ${zone.bottom.toFixed(4)}`,
                                'Bullish momentum confirmation'
                            ],
                            expireMinutes: 120
                        };
                    }
                }
            }
        }
        return null;
    }
}
