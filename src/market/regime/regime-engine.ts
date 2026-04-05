import { MarketRegimeType } from '../../core/constants/enums.js';
import { Candle, IndicatorSnapshot, MarketRegime } from '../../core/types/bot-types.js';

export class MarketRegimeEngine {
  static classify(candles: Candle[], indicators: IndicatorSnapshot): MarketRegime {
    const currentPrice = candles[candles.length - 1].close;
    const { ema20, ema50, adx, bbUpper, bbLower, bbMid } = indicators;
    
    const bbWidth = (bbUpper - bbLower) / bbMid;
    // HTF: slightly relaxed trend threshold (0.3% vs 0.5% on 15m)
    const isTrending = Math.abs(ema20 - ema50) > (currentPrice * 0.003) && adx > 22;
    const isPanic = indicators.rsi > 80 || indicators.rsi < 20;

    if (isPanic) {
      return { type: MarketRegimeType.PANIC, strength: 80, description: 'Extreme conditions (RSI)' };
    }

    const last = candles[candles.length - 1];
    if (Math.abs(last.close - last.open) > indicators.atr * 2) {
      return { type: MarketRegimeType.VOLATILITY_EXPANSION, strength: 75, description: 'High volatility expansion' };
    }

    if (isTrending) {
      const direction = ema20 > ema50 ? 'BULLISH' : 'BEARISH';
      return { type: MarketRegimeType.TREND, strength: 70, description: `Strong ${direction} momentum` };
    }

    if (bbWidth < 0.001) {
      return { type: MarketRegimeType.RANGE, strength: 60, description: 'Tight range (Squeeze)' };
    }

    if (adx < 20) {
      return { type: MarketRegimeType.RANGE, strength: 50, description: 'Sideways consolidation' };
    }

    return { type: MarketRegimeType.RANGE, strength: 40, description: 'Chop / Low momentum' };
  }
}
