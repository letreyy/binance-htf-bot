export type MarketSession = 'ASIA' | 'LONDON' | 'NEW_YORK';

export class TimeFilters {
    /**
     * HTF bot doesn't need strict session filtering — 1H candles span across sessions.
     * We still track sessions for context and combo filtering.
     */
    static getCurrentSession(date: Date = new Date()): MarketSession {
        const utcHour = date.getUTCHours();

        if (utcHour >= 13 && utcHour < 21) {
            return 'NEW_YORK';
        }
        
        if (utcHour >= 6 && utcHour < 13) {
            return 'LONDON';
        }

        return 'ASIA';
    }

    /**
     * On HTF, almost all strategies are allowed in all sessions.
     * Only pure scalp strategies (not present in this bot) would be blocked.
     */
    static isStrategyAllowed(_strategyId: string, _session: MarketSession): boolean {
        // HTF strategies work across all sessions
        return true;
    }
}
