import { Candle } from '../../core/types/bot-types.js';
export declare class BinanceClient {
    private axiosInstance;
    constructor();
    private requestWithRetry;
    getExchangeInfo(): Promise<any>;
    get24hTicker(): Promise<any[]>;
    getKlines(symbol: string, interval: string, limit?: number): Promise<Candle[]>;
    getFundingRate(symbol: string): Promise<{
        rate: number;
        nextFundingTime: number;
    } | null>;
    getOpenInterest(symbol: string): Promise<number | null>;
    getOpenInterestHist(symbol: string, period: string, limit?: number): Promise<number[]>;
}
export declare const binanceClient: BinanceClient;
