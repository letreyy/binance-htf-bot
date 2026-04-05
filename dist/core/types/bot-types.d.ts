import { MarketRegimeType, SignalDirection } from '../constants/enums.js';
export interface Candle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    quoteVolume: number;
}
export interface IndicatorSnapshot {
    ema20: number;
    ema50: number;
    ema200: number;
    emaRibbon: number[];
    rsi: number;
    atr: number;
    adx: number;
    bbUpper: number;
    bbMid: number;
    bbLower: number;
    vwap: number;
    volumeSma: number;
}
export interface MarketRegime {
    type: MarketRegimeType;
    strength: number;
    description: string;
}
export interface LiquidityContext {
    sweptHigh: boolean;
    sweptLow: boolean;
    reclaimedLevel: number | null;
    localRangeHigh: number | null;
    localRangeLow: number | null;
    structureQuality: number;
    isWickSweep: boolean;
}
export interface SignalLevels {
    entry: number;
    sl: number;
    tp: number[];
    riskPercent: number;
    rrRatio: number;
}
export interface FundingData {
    rate: number;
    nextFundingTime: number;
}
export interface OpenInterestData {
    oi: number;
    oiHistory: number[];
}
export interface StrategyContext {
    symbol: string;
    timeframe: string;
    candles: Candle[];
    candles4h?: Candle[];
    indicators: IndicatorSnapshot;
    prevIndicators: IndicatorSnapshot;
    regime: MarketRegime;
    liquidity: LiquidityContext;
    funding?: FundingData;
    openInterest?: OpenInterestData;
    btcContext?: {
        price: number;
        ema200: number;
        trend: 'BULLISH' | 'BEARISH';
    };
}
export interface StrategySignalCandidate {
    strategyName: string;
    direction: SignalDirection;
    orderType?: 'MARKET' | 'LIMIT';
    suggestedEntry?: number;
    suggestedTarget?: number;
    suggestedSl?: number;
    confidence: number;
    reasons: string[];
    expireMinutes: number;
}
export interface FinalSignal extends StrategySignalCandidate {
    symbol: string;
    timeframe: string;
    levels: SignalLevels;
    regime: MarketRegime;
    score: number;
    confidenceLabel: string;
    timestamp: number;
    leverageSuggestion: number;
}
