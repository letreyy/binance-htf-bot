import { FinalSignal, StrategyContext } from '../core/types/bot-types.js';
import { SignalDirection } from '../core/constants/enums.js';
import { Strategy } from '../strategies/base/strategy.js';
interface PaperTrade {
    id: string;
    symbol: string;
    direction: SignalDirection;
    entryPrice: number;
    sl: number;
    tp: number[];
    tpHit: number;
    remainingPortion: number;
    leverage: number;
    accumulatedPnl: number;
    timestamp: number;
    strategyName: string;
    history: string[];
    status: 'PENDING' | 'ACTIVE';
    expireAt: number;
    orderType: 'MARKET' | 'LIMIT';
    dcaCount: number;
}
export declare class TradeExecutor {
    private exchange;
    private isLive;
    private activeTrades;
    private todaysPnlPercent;
    private strategyStats;
    private disabledStrategies;
    private slCooldown;
    private targetRiskPercent;
    private leverageConfig;
    private registeredStrategies;
    init(strategies: Strategy[]): Promise<void>;
    isStrategyDisabled(strategyName: string): boolean;
    isOnSlCooldown(symbol: string, strategyName: string): boolean;
    calculateLeverage(slDistancePercent: number): number;
    updatePaperTrades(ctx: StrategyContext): Promise<void>;
    private recordStrategyResult;
    getActiveTrade(symbol: string): PaperTrade | undefined;
    processSignal(signal: FinalSignal, currentPrice?: number): Promise<void>;
    private executeLiveTrade;
    private calculateLivePositionSize;
    panicCloseAll(): Promise<void>;
}
export declare const tradeExecutor: TradeExecutor;
export {};
