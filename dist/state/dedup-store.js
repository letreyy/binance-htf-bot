import { config } from '../config/index.js';
import { logger } from '../core/utils/logger.js';
export class DedupStore {
    cache = new Map();
    dailyCounts = new Map();
    isCooldown(symbol, strategy, side) {
        const key = `${symbol}:${strategy}:${side}`;
        const lastAlert = this.cache.get(key);
        const cooldownMs = config.cooldown.minutes * 60 * 1000;
        if (lastAlert && Date.now() - lastAlert < cooldownMs) {
            return true;
        }
        const globalCount = Array.from(this.dailyCounts.values()).reduce((a, b) => a + b, 0);
        if (globalCount >= config.cooldown.maxPerDayGlobal) {
            logger.warn('Global daily alert limit reached');
            return true;
        }
        const symbolCount = this.dailyCounts.get(symbol) || 0;
        if (symbolCount >= config.cooldown.maxPerDayPerSymbol) {
            logger.warn(`Symbol ${symbol} daily alert limit reached`);
            return true;
        }
        return false;
    }
    recordAlert(symbol, strategy, side) {
        const key = `${symbol}:${strategy}:${side}`;
        this.cache.set(key, Date.now());
        this.dailyCounts.set(symbol, (this.dailyCounts.get(symbol) || 0) + 1);
    }
}
export const dedupStore = new DedupStore();
//# sourceMappingURL=dedup-store.js.map