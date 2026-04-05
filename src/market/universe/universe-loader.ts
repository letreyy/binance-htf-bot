import { binanceClient } from '../../exchange/binance/binance-client.js';
import { config } from '../../config/index.js';
import { logger } from '../../core/utils/logger.js';

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

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
      
      const perpetuals = ticker
        .filter(t => t.symbol.endsWith('USDT'))
        .filter(t => {
          const onboard = this.listingDates.get(t.symbol);
          if (onboard && now - onboard < TWO_WEEKS_MS) {
            return false;
          }
          return true;
        })
        .filter(t => !this.disabledSymbols.has(t.symbol))
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, config.bot.topN)
        .map(t => t.symbol);

      this.cachedSymbols = perpetuals;
      this.lastUpdate = now;
      logger.info(`Universe updated. Top ${perpetuals.length} symbols loaded.`);
      return perpetuals;
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
