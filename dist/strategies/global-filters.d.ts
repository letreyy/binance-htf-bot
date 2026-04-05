import { StrategyContext } from '../core/types/bot-types.js';
import { SignalDirection } from '../core/constants/enums.js';
export interface FilterConfig {
    htfTrendEnabled: boolean;
    volatilityMinAtrPct: number;
    volatilityMaxAtrPct: number;
    deadHoursUTC: number[];
    btcFilterEnabled: boolean;
}
export declare const filterConfig: FilterConfig;
export declare function passesGlobalFilters(ctx: StrategyContext): boolean;
export declare function passesDirectionFilter(ctx: StrategyContext, direction: SignalDirection, strategyName?: string): boolean;
