import { StrategyContext, StrategySignalCandidate, Candle } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * HTF Order Block Retest — adapted for 1H
 * 
 * On 1H, order blocks are more significant and longer-lasting.
 * - Wider lookback (24 candles = 24 hours)
 * - Larger impulse threshold (2× ATR)
 * - Longer expiry (24h for limit orders)
 * - Approach zone widened to 3%
 */
export class HtfOrderBlockStrategy implements Strategy {
    name = 'HTF Order Block';
    id = 'htf-order-block';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 60) return null;

        const LOOKBACK = 24; // 24 hours
        
        for (let i = candles.length - 1; i >= candles.length - LOOKBACK; i--) {
            const current = candles[i];
            const prev1 = candles[i - 1];
            const prev2 = candles[i - 2];
            if (!prev1 || !prev2) continue;

            // ─── Bullish Order Block ───
            const isBullImpulse = 
                current.close > current.open &&
                prev1.close > prev1.open &&
                (current.close - prev1.open) > (indicators.atr * 2.0);

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
                    if (lastPrice > obHigh && lastPrice < obHigh * 1.03) {
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

            // ─── Bearish Order Block ───
            const isBearImpulse = 
                current.close < current.open &&
                prev1.close < prev1.open &&
                (prev1.open - current.close) > (indicators.atr * 2.0);

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
                    if (lastPrice < obLow && lastPrice > obLow * 0.97) {
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
 * HTF Fair Value Gap — adapted for 1H
 * 
 * 1H FVGs are more significant and are respected better than 15m FVGs.
 * - Wider lookback (72 candles = 3 days)
 * - Relaxed volume multiplier (1.4x — 1H naturally has more volume)
 * - FVG age tolerance: up to 48 candles (2 days)
 * - 24h limit order expiry
 */
const FVG_LOOKBACK = 72;
const FVG_MIN_SIZE_PCT = 0.12;
const FVG_VOLUME_MULTIPLIER = 1.4;

interface FVGZone {
    top: number;
    bottom: number;
    midpoint: number;
    direction: 'BULLISH' | 'BEARISH';
    strength: number;
    candleIdx: number;
    volumeStrength: number;
    partiallyFilled: boolean;
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
                zones.push({ top, bottom, midpoint, direction: 'BULLISH', strength: (gapSize / midPrice) * 100, candleIdx: i, volumeStrength: volStrength, partiallyFilled });
            }
        }

        if (c0.low > c2.high) {
            const gapSize = c0.low - c2.high;
            if (gapSize >= minSize) {
                const top = c0.low;
                const bottom = c2.high;
                const midpoint = (top + bottom) / 2;
                const partiallyFilled = candles.slice(i + 2).some(c => c.high > midpoint);
                zones.push({ top, bottom, midpoint, direction: 'BEARISH', strength: (gapSize / midPrice) * 100, candleIdx: i, volumeStrength: volStrength, partiallyFilled });
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

        const currentIdx = candles.length - 1;

        for (const zone of fvgZones) {
            const age = currentIdx - zone.candleIdx;

            if (age < 2 || age > 48) continue;  // 2 days max on 1H
            if (zone.partiallyFilled) continue;

            if (zone.direction === 'BULLISH' && currentPrice > zone.midpoint) {
                if (indicators.ema50 < indicators.ema200) continue;
                if (indicators.rsi > 72) continue;
                if ((currentPrice - zone.midpoint) / zone.midpoint > 0.06) continue;

                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    orderType: 'LIMIT',
                    suggestedEntry: zone.midpoint,
                    suggestedTarget: ctx.liquidity.localRangeHigh || (zone.top + (zone.top - zone.bottom) * 3),
                    suggestedSl: zone.bottom - (indicators.atr * 0.3),
                    confidence: 83,
                    reasons: [
                        `1H Bullish FVG: ${zone.bottom.toFixed(4)}–${zone.top.toFixed(4)}`,
                        `Equilibrium entry: ${zone.midpoint.toFixed(4)}`,
                        `Gap: ${zone.strength.toFixed(3)}% | Vol: ${zone.volumeStrength.toFixed(1)}x`,
                        `Age: ${age}h`
                    ],
                    expireMinutes: 60 * 24
                };
            }

            if (zone.direction === 'BEARISH' && currentPrice < zone.midpoint) {
                if (indicators.ema50 > indicators.ema200) continue;
                if (indicators.rsi < 28) continue;
                if ((zone.midpoint - currentPrice) / zone.midpoint > 0.06) continue;

                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    orderType: 'LIMIT',
                    suggestedEntry: zone.midpoint,
                    suggestedTarget: ctx.liquidity.localRangeLow || (zone.bottom - (zone.top - zone.bottom) * 3),
                    suggestedSl: zone.top + (indicators.atr * 0.3),
                    confidence: 83,
                    reasons: [
                        `1H Bearish FVG: ${zone.bottom.toFixed(4)}–${zone.top.toFixed(4)}`,
                        `Equilibrium entry: ${zone.midpoint.toFixed(4)}`,
                        `Gap: ${zone.strength.toFixed(3)}% | Vol: ${zone.volumeStrength.toFixed(1)}x`,
                        `Age: ${age}h`
                    ],
                    expireMinutes: 60 * 24
                };
            }
        }

        return null;
    }
}

export class HtfObMagnetStrategy implements Strategy {
    name = 'HTF OB Magnet';
    id = 'htf-ob-magnet';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 60) return null;

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

                if (unmitigated && currentPrice > obHigh + (indicators.atr * 1.5)) {
                    if (last.close < last.open && last.close < indicators.ema20 && prev.close > prev.open) {
                        const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.SHORT,
                            orderType: 'MARKET',
                            suggestedEntry: currentPrice,
                            suggestedTarget: obHigh,
                            suggestedSl: swingHigh + (indicators.atr * 0.2),
                            confidence: 76,
                            reasons: [
                                `Magnet: Price drawn to Bullish OB at ${obHigh.toFixed(4)}`,
                                'Shorting the pullback towards the unmitigated OB',
                                'Bearish momentum confirmation'
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

                if (unmitigated && currentPrice < obLow - (indicators.atr * 1.5)) {
                    if (last.close > last.open && last.close > indicators.ema20 && prev.close < prev.open) {
                        const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.LONG,
                            orderType: 'MARKET',
                            suggestedEntry: currentPrice,
                            suggestedTarget: obLow,
                            suggestedSl: swingLow - (indicators.atr * 0.2),
                            confidence: 76,
                            reasons: [
                                `Magnet: Price drawn to Bearish OB at ${obLow.toFixed(4)}`,
                                'Longing the pullback towards the unmitigated OB',
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

export class HtfFvgMagnetStrategy implements Strategy {
    name = 'HTF FVG Magnet';
    id = 'htf-fvg-magnet';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < FVG_LOOKBACK + 5) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const currentPrice = last.close;

        const fvgZones = findFVGs(candles, indicators.volumeSma);
        if (fvgZones.length === 0) return null;

        const currentIdx = candles.length - 1;

        for (const zone of fvgZones) {
            const age = currentIdx - zone.candleIdx;
            if (age < 2 || age > 48 || zone.partiallyFilled) continue;

            if (zone.direction === 'BULLISH' && currentPrice > zone.midpoint) {
                if (currentPrice > zone.top + (indicators.atr * 1.5)) {
                    if (last.close < last.open && last.close < indicators.ema20 && prev.close > prev.open) {
                        const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.SHORT,
                            orderType: 'MARKET',
                            suggestedEntry: currentPrice,
                            suggestedTarget: zone.midpoint,
                            suggestedSl: swingHigh + (indicators.atr * 0.2),
                            confidence: 77,
                            reasons: [
                                `Magnet: Price drawn to Bullish FVG at ${zone.top.toFixed(4)}`,
                                'Shorting the pullback towards the gap',
                                'Bearish momentum confirmation'
                            ],
                            expireMinutes: 120
                        };
                    }
                }
            }

            if (zone.direction === 'BEARISH' && currentPrice < zone.midpoint) {
                if (currentPrice < zone.bottom - (indicators.atr * 1.5)) {
                    if (last.close > last.open && last.close > indicators.ema20 && prev.close < prev.open) {
                        const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.LONG,
                            orderType: 'MARKET',
                            suggestedEntry: currentPrice,
                            suggestedTarget: zone.midpoint,
                            suggestedSl: swingLow - (indicators.atr * 0.2),
                            confidence: 77,
                            reasons: [
                                `Magnet: Price drawn to Bearish FVG at ${zone.bottom.toFixed(4)}`,
                                'Longing the pullback towards the gap',
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
