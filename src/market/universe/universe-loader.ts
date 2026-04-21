import { binanceClient } from '../../exchange/binance/binance-client.js';
import { config } from '../../config/index.js';
import { logger } from '../../core/utils/logger.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_QUOTE_VOLUME_USD = 200_000_000; // $200M/24h minimum

// Patterns that indicate memecoin / low-float / unstable tokens.
// These produce extreme 1H wicks that destroy HTF signals.
const MEMECOIN_PATTERNS: RegExp[] = [
    /^1000/,             // 1000PEPE, 1000SHIB, 1000FLOKI, 1000BONK etc.
    /PEPE/,
    /FLOKI/,
    /SHIB/,
    /BONK/,
    /DOGE/,
    /WIF/,
    /MEME/,
    /MOG/,
    /POPCAT/,
    /TURBO/,
    /GOAT/,
    /AIDOGE/,
];

function looksLikeMemecoin(symbol: string): boolean {
    return MEMECOIN_PATTERNS.some(re => re.test(symbol));
}

export class UniverseLoader {
    private lastUpdate: number = 0;
    private cachedSymbols: string[] = [];
    private listingDates: Map<string, number> = new Map();
    private listingDatesFetched: boolean = false;
    private disabledSymbols: Set<string> = new Set();

    private async fetchListingDates(): Promise<void> {
        if (this.listingDatesFetched) return;
        try {
            const info = await binanceClient.getExchangeInfo();
            for (const s of info.symbols) {
                if (s.onboardDate) {
                    this.listingDates.set(s.symbol, s.onboardDate);
                }
            }
            this.listingDatesFetched = true;
            logger.info(`Loaded listing dates for ${this.listingDates.size} symbols`);
        } catch (err: any) {
            logger.error('Failed to fetch exchange info for listing dates', { error: err.message });
        }
    }

    async getTopSymbols(): Promise<string[]> {
        const now = Date.now();
        const updateInterval = config.bot.universeRefreshMinutes * 60 * 1000;

        if (this.cachedSymbols.length > 0 && (now - this.lastUpdate < updateInterval)) {
            return this.cachedSymbols;
        }

        await this.fetchListingDates();

        try {
            logger.info('Refreshing universe (Top-N symbols by 24h volume)...');
            const ticker = await binanceClient.get24hTicker();

            const filtered = ticker
                .filter(t => t.symbol.endsWith('USDT'))
                .filter(t => {
                    // Listed < 30 days = no stable price history for 1H
                    const onboard = this.listingDates.get(t.symbol);
                    if (onboard && now - onboard < THIRTY_DAYS_MS) return false;
                    return true;
                })
                .filter(t => !this.disabledSymbols.has(t.symbol))
                .filter(t => !looksLikeMemecoin(t.symbol))
                .filter(t => parseFloat(t.quoteVolume) >= MIN_QUOTE_VOLUME_USD)
                .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
                .slice(0, config.bot.topN)
                .map(t => t.symbol);

            this.cachedSymbols = filtered;
            this.lastUpdate = now;
            logger.info(`Universe updated. ${filtered.length} symbols (min vol $${(MIN_QUOTE_VOLUME_USD / 1e6).toFixed(0)}M, memecoins filtered).`);
            return filtered;
        } catch (err: any) {
            logger.error('Failed to refresh universe', { error: err.message });
            return this.cachedSymbols || [];
        }
    }

    disableSymbol(symbol: string): void {
        this.disabledSymbols.add(symbol.toUpperCase());
        this.lastUpdate = 0;
    }

    enableSymbol(symbol: string): void {
        this.disabledSymbols.delete(symbol.toUpperCase());
        this.lastUpdate = 0;
    }

    isSymbolDisabled(symbol: string): boolean {
        return this.disabledSymbols.has(symbol.toUpperCase());
    }

    getDisabledSymbols(): string[] {
        return Array.from(this.disabledSymbols);
    }
}

export const universeLoader = new UniverseLoader();
