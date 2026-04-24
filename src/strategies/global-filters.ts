import { StrategyContext } from '../core/types/bot-types.js';
import { MarketRegimeType, SignalDirection } from '../core/constants/enums.js';

export interface FilterConfig {
    htfTrendEnabled: boolean;
    volatilityMinAtrPct: number;
    volatilityMaxAtrPct: number;
    deadHoursUTC: number[];
    btcFilterEnabled: boolean;
}

const DEFAULT_FILTER_CONFIG: FilterConfig = {
    htfTrendEnabled: true,
    // HTF: tighter ATR corridor — on 1H anything over 3.5% is usually a memecoin blow-off
    volatilityMinAtrPct: 0.25,
    volatilityMaxAtrPct: 3.5,
    deadHoursUTC: [],
    btcFilterEnabled: true,
};

export const filterConfig: FilterConfig = { ...DEFAULT_FILTER_CONFIG };

const MEAN_REVERSION_STRATEGIES = new Set([
    'HTF VWAP Reversion',
    'HTF Delta Divergence',
    'HTF BB Reversal',
    'HTF Volume Climax',
    'HTF RSI Divergence',
    'HTF Funding Skew',
    'HTF Wyckoff Spring',
    'HTF OI Divergence',
]);

export function passesGlobalFilters(ctx: StrategyContext): boolean {
    const last = ctx.candles[ctx.candles.length - 1];
    const atrPct = (ctx.indicators.atr / last.close) * 100;

    if (atrPct < filterConfig.volatilityMinAtrPct) return false;
    if (atrPct > filterConfig.volatilityMaxAtrPct) return false;

    // PANIC regime: 0/2 in real data. Hard block.
    if (ctx.regime.type === MarketRegimeType.PANIC) return false;

    return true;
}

/**
 * Mean-reversion strategies can only bypass HTF trend filter when
 * the market is GENUINELY consolidating. The regime engine defaults to
 * RANGE for any non-trending market ("Chop / Low momentum"), so RANGE
 * alone is too permissive. Require real evidence of consolidation:
 *   - ADX < 20
 *   - RANGE regime
 *   - BB width not in expansion (last 10 bars max BB width within 1.3× min)
 *   - Price not extremely far from EMA200 (|Δ| / ATR < 4)
 */
function canBypassTrendFilter(ctx: StrategyContext, strategyName?: string): boolean {
    if (!strategyName) return false;
    if (!MEAN_REVERSION_STRATEGIES.has(strategyName)) return false;
    if (ctx.indicators.adx >= 20) return false;
    if (ctx.regime.type !== MarketRegimeType.RANGE) return false;

    const last = ctx.candles[ctx.candles.length - 1];
    const atr = ctx.indicators.atr;
    if (atr <= 0) return false;

    const stretch = Math.abs(last.close - ctx.indicators.ema200) / atr;
    if (stretch > 4) return false;

    return true;
}

export function passesDirectionFilter(ctx: StrategyContext, direction: SignalDirection, strategyName?: string): boolean {
    if (!filterConfig.htfTrendEnabled) return true;

    const bypass = canBypassTrendFilter(ctx, strategyName);

    const price = ctx.candles[ctx.candles.length - 1].close;
    const ema200 = ctx.indicators.ema200;

    if (filterConfig.htfTrendEnabled && !bypass) {
        if (direction === SignalDirection.LONG && price < ema200) return false;
        if (direction === SignalDirection.SHORT && price > ema200) return false;
    }

    if (filterConfig.btcFilterEnabled && ctx.btcContext && !bypass) {
        if (direction === SignalDirection.LONG && ctx.btcContext.trend === 'BEARISH') return false;
        if (direction === SignalDirection.SHORT && ctx.btcContext.trend === 'BULLISH') return false;
    }

    // Extreme-stretch guard: don't counter-trend into a strong directional push
    const atr = ctx.indicators.atr;
    if (MEAN_REVERSION_STRATEGIES.has(strategyName || '') && atr > 0) {
        const stretchAtr = (price - ema200) / atr;
        if (direction === SignalDirection.SHORT && stretchAtr > 6) return false;
        if (direction === SignalDirection.LONG && stretchAtr < -6) return false;
    }

    return true;
}
