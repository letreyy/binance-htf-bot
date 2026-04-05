export declare class UniverseLoader {
    private lastUpdate;
    private cachedSymbols;
    private listingDates;
    private listingDatesFetched;
    private disabledSymbols;
    private fetchListingDates;
    getTopSymbols(): Promise<string[]>;
    disableSymbol(symbol: string): void;
    enableSymbol(symbol: string): void;
    isSymbolDisabled(symbol: string): boolean;
    getDisabledSymbols(): string[];
}
export declare const universeLoader: UniverseLoader;
