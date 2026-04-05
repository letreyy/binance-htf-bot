import { SignalDirection } from '../core/constants/enums.js';
import { logger } from '../core/utils/logger.js';
export const COMBO_DEFINITIONS = [
    {
        name: 'HTF Liquidity Trap',
        id: 'combo-htf-liquidity-trap',
        requiredStrategies: ['HTF Liquidity Sweep', 'HTF Delta Divergence', 'HTF Breakout Failure'],
        minMatch: 2,
        contextFilter: (ctx) => {
            const last = ctx.candles[ctx.candles.length - 1];
            return last.volume > ctx.indicators.volumeSma * 1.5;
        },
        confidence: 90,
        reasons: ['COMBO: HTF Liquidity trap', 'Multiple reversal signals on 1H', 'Volume confirms trap'],
        expireMinutes: 240
    },
    {
        name: 'HTF Trend Continuation',
        id: 'combo-htf-trend',
        requiredStrategies: ['HTF EMA Pullback', 'HTF EMA Cross', 'HTF Order Block'],
        minMatch: 2,
        confidence: 88,
        reasons: ['COMBO: HTF Trend continuation', 'EMA + structure alignment on 1H'],
        expireMinutes: 360
    },
    {
        name: 'HTF Mean Reversion Pro',
        id: 'combo-htf-mean-reversion',
        requiredStrategies: ['HTF VWAP Reversion', 'HTF BB Reversal', 'HTF RSI Divergence'],
        minMatch: 2,
        confidence: 87,
        reasons: ['COMBO: HTF Mean Reversion', 'Multiple reversion signals converging on 1H'],
        expireMinutes: 240
    },
    {
        name: 'HTF Exhaustion Reversal',
        id: 'combo-htf-exhaustion',
        requiredStrategies: ['HTF Volume Climax', 'HTF RSI Divergence', 'HTF Delta Divergence'],
        minMatch: 2,
        confidence: 89,
        reasons: ['COMBO: HTF Exhaustion', 'Volume climax + divergence = capitulation', 'Institutional footprint on 1H'],
        expireMinutes: 360
    }
];
export class CombinationEngine {
    static evaluate(individualSignals, ctx) {
        if (individualSignals.length < 2)
            return [];
        const combos = [];
        for (const combo of COMBO_DEFINITIONS) {
            const longSignals = individualSignals.filter(s => s.direction === SignalDirection.LONG);
            const shortSignals = individualSignals.filter(s => s.direction === SignalDirection.SHORT);
            const longCombo = this.checkCombo(combo, longSignals, ctx, SignalDirection.LONG);
            if (longCombo)
                combos.push(longCombo);
            const shortCombo = this.checkCombo(combo, shortSignals, ctx, SignalDirection.SHORT);
            if (shortCombo)
                combos.push(shortCombo);
        }
        return combos;
    }
    static checkCombo(combo, signals, ctx, direction) {
        const matchingNames = signals
            .filter(s => combo.requiredStrategies.includes(s.strategyName))
            .map(s => s.strategyName);
        const uniqueMatches = [...new Set(matchingNames)];
        if (uniqueMatches.length < combo.minMatch)
            return null;
        if (combo.contextFilter && !combo.contextFilter(ctx))
            return null;
        const matchedReasons = uniqueMatches.map(n => `✓ ${n}`);
        logger.info(`[COMBO] ${combo.name} triggered: ${uniqueMatches.join(' + ')} → ${direction}`);
        return {
            strategyName: combo.name,
            direction,
            confidence: combo.confidence,
            reasons: [...combo.reasons, ...matchedReasons],
            expireMinutes: combo.expireMinutes
        };
    }
}
//# sourceMappingURL=combination-engine.js.map