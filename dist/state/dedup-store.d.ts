export declare class DedupStore {
    private cache;
    private dailyCounts;
    isCooldown(symbol: string, strategy: string, side: string): boolean;
    recordAlert(symbol: string, strategy: string, side: string): void;
}
export declare const dedupStore: DedupStore;
