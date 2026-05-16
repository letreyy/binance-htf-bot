import { FinalSignal, StrategyContext } from '../core/types/bot-types.js';
import { SignalDirection } from '../core/constants/enums.js';
import { Strategy } from '../strategies/base/strategy.js';
interface PaperTrade {
    id: string;
    symbol: string;
    direction: SignalDirection;
    entryPrice: number;
    initialSl: number;
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
    activatedAt: number;
    mfe: number;
    mae: number;
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
    private recentSignalDirections;
    init(strategies: Strategy[]): Promise<void>;
    isStrategyDisabled(strategyName: string): boolean;
    isOnSlCooldown(symbol: string, strategyName: string): boolean;
    calculateLeverage(slDistancePercent: number): number;
    updatePaperTrades(ctx: StrategyContext): Promise<void>;
    private recordStrategyResult;
    getActiveTrade(symbol: string): PaperTrade | undefined;
    /**
     * Get number of currently active positions or pending limit orders
     */
    getActiveAndPendingCount(): number;
    /**
     * Get number of active/pending trades in a specific direction
     */
    getActiveCountByDirection(direction: SignalDirection): number;
    /**
     * Check correlation cluster exposure. Returns true if adding this symbol
     * would push its correlation group above MAX_PER_GROUP active trades.
     */
    exceedsCorrelationCap(symbol: string): boolean;
    getCorrelationGroup(symbol: string): string | null;
    /**
     * Record an issued signal direction for the rolling 24h directional cap.
     */
    recordSignalDirection(direction: SignalDirection): void;
    /**
     * Returns true if adding a new signal in `direction` would push the 24h
     * directional share above the cap. No-op until MIN_SIGNALS accumulated.
     */
    exceedsDirectionalDailyCap(direction: SignalDirection): boolean;
    processSignal(signal: FinalSignal, _currentPrice?: number): Promise<void>;
    private executeLiveTrade;
    private calculateLivePositionSize;
    panicCloseAll(): Promise<void>;
}
export declare const tradeExecutor: TradeExecutor;
export {};
