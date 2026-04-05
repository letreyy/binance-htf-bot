export class TimeFilters {
    /**
     * HTF bot doesn't need strict session filtering — 1H candles span across sessions.
     * We still track sessions for context and combo filtering.
     */
    static getCurrentSession(date = new Date()) {
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
    static isStrategyAllowed(_strategyId, _session) {
        // HTF strategies work across all sessions
        return true;
    }
}
//# sourceMappingURL=time-filters.js.map