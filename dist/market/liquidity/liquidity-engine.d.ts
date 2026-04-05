import { Candle, LiquidityContext } from '../../core/types/bot-types.js';
export declare class LiquidityEngine {
    /**
     * HTF liquidity analysis — uses wider lookback (48 candles = 48 hours on 1H)
     */
    static getContext(candles: Candle[], lookback?: number): LiquidityContext;
}
