import { Candle, IndicatorSnapshot } from '../../core/types/bot-types.js';
export declare class TechnicalIndicators {
    static ema(data: number[], period: number): number;
    static rsi(data: number[], period: number): number;
    static atr(candles: Candle[], period: number): number;
    static adx(candles: Candle[], period: number): number;
    static bollingerBands(data: number[], period: number, stdDev: number): {
        upper: number;
        mid: number;
        lower: number;
    };
    static vwap(candles: Candle[]): number;
    static calculateSnapshot(candles: Candle[]): IndicatorSnapshot;
}
