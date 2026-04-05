export declare class StatsService {
    private trades;
    private activePauses;
    constructor();
    private load;
    private save;
    recordTrade(strategyName: string, pnl: number): void;
    isPaused(strategyName: string): boolean;
    private checkUnlock;
    private evaluatePauses;
    private applyPause;
}
export declare const statsService: StatsService;
