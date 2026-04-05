export type MarketSession = 'ASIA' | 'LONDON' | 'NEW_YORK';
export declare class TimeFilters {
    /**
     * HTF bot doesn't need strict session filtering — 1H candles span across sessions.
     * We still track sessions for context and combo filtering.
     */
    static getCurrentSession(date?: Date): MarketSession;
    /**
     * On HTF, almost all strategies are allowed in all sessions.
     * Only pure scalp strategies (not present in this bot) would be blocked.
     */
    static isStrategyAllowed(_strategyId: string, _session: MarketSession): boolean;
}
