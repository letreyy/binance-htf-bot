export declare const config: {
    binance: {
        apiKey: string;
        apiSecret: string;
        isLiveMode: boolean;
        baseUrl: string;
    };
    telegram: {
        token: string;
        chatId: string;
        baseUrl: string;
        proxy: string;
    };
    bot: {
        logLevel: string;
        scanIntervalSeconds: number;
        universeRefreshMinutes: number;
        topN: number;
        minSignalScore: number;
        minProfitLeveraged: number;
        targetRiskPercent: number;
        primaryTimeframe: "1h";
        htfTimeframe: "4h";
        klinesLimit: number;
    };
    indicators: {
        emaFast: number;
        emaMid: number;
        emaSlow: number;
        rsi: number;
        atr: number;
        adx: number;
        bbLength: number;
        bbMult: number;
        volSma: number;
        vwapStdLen: number;
    };
    cooldown: {
        minutes: number;
        maxPerDayPerSymbol: number;
        maxPerDayGlobal: number;
    };
    weights: {
        trendAlignment: number;
        volumeSpike: number;
        atrExpansion: number;
        candleQuality: number;
        liquidityContext: number;
        regimeAlignment: number;
        riskReward: number;
    };
};
