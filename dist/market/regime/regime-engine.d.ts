import { Candle, IndicatorSnapshot, MarketRegime } from '../../core/types/bot-types.js';
export declare class MarketRegimeEngine {
    static classify(candles: Candle[], indicators: IndicatorSnapshot): MarketRegime;
}
