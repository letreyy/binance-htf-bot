import { Candle, LiquidityContext } from '../../core/types/bot-types.js';

export class LiquidityEngine {
  /**
   * HTF liquidity analysis — uses wider lookback (48 candles = 48 hours on 1H)
   */
  static getContext(candles: Candle[], lookback: number = 48): LiquidityContext {
    const last = candles[candles.length - 1];
    const slice = candles.slice(-lookback - 1, -1);
    
    const highs = slice.map(c => c.high);
    const lows = slice.map(c => c.low);
    const prevHigh = Math.max(...highs);
    const prevLow = Math.min(...lows);

    const sweptHigh = last.high > prevHigh && last.close < prevHigh;
    const sweptLow = last.low < prevLow && last.close > prevLow;
    
    const isWickSweep = (sweptHigh || sweptLow) && (Math.abs(last.high - last.low) / Math.abs(last.open - last.close)) > 2;

    return {
      sweptHigh,
      sweptLow,
      reclaimedLevel: sweptHigh ? prevHigh : (sweptLow ? prevLow : null),
      localRangeHigh: prevHigh,
      localRangeLow: prevLow,
      structureQuality: 70,
      isWickSweep
    };
  }
}
