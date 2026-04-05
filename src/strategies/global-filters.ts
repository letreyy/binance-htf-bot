import { StrategyContext } from '../core/types/bot-types.js';
import { SignalDirection } from '../core/constants/enums.js';

export interface FilterConfig {
    htfTrendEnabled: boolean;
    volatilityMinAtrPct: number;
    volatilityMaxAtrPct: number;
    deadHoursUTC: number[];
    btcFilterEnabled: boolean;
}

const DEFAULT_FILTER_CONFIG: FilterConfig = {
    htfTrendEnabled: true,
    // HTF: wider ATR corridor (1H candles naturally have larger ATR%)
    volatilityMinAtrPct: 0.15,   // Below 0.15% = too flat on 1H
    volatilityMaxAtrPct: 8.0,    // Above 8% = extreme event
    deadHoursUTC: [],            // No dead hours for HTF — 1H candles span sessions
    btcFilterEnabled: true,
};

export const filterConfig: FilterConfig = { ...DEFAULT_FILTER_CONFIG };

const MEAN_REVERSION_STRATEGIES = new Set([
    'HTF VWAP Reversion',
    'HTF Delta Divergence',
    'HTF BB Reversal',
    'HTF Volume Climax',
    'HTF RSI Divergence',
    'HTF OB Magnet',
    'HTF FVG Magnet',
]);

export function passesGlobalFilters(ctx: StrategyContext): boolean {
    const last = ctx.candles[ctx.candles.length - 1];
    const atrPct = (ctx.indicators.atr / last.close) * 100;

    if (atrPct < filterConfig.volatilityMinAtrPct) {
        return false;
    }
    if (atrPct > filterConfig.volatilityMaxAtrPct) {
        return false;
    }

    return true;
}

export function passesDirectionFilter(ctx: StrategyContext, direction: SignalDirection, strategyName?: string): boolean {
    if (!filterConfig.htfTrendEnabled) return true;

    const isMeanReversion = strategyName ? MEAN_REVERSION_STRATEGIES.has(strategyName) : false;

    const price = ctx.candles[ctx.candles.length - 1].close;
    const ema200 = ctx.indicators.ema200;

    if (filterConfig.htfTrendEnabled && !isMeanReversion) {
        if (direction === SignalDirection.LONG && price < ema200) return false;
        if (direction === SignalDirection.SHORT && price > ema200) return false;
    }

    if (filterConfig.btcFilterEnabled && ctx.btcContext && !isMeanReversion) {
        if (direction === SignalDirection.LONG && ctx.btcContext.trend === 'BEARISH') return false;
        if (direction === SignalDirection.SHORT && ctx.btcContext.trend === 'BULLISH') return false;
    }

    return true;
}
