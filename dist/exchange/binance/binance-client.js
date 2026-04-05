import axios from 'axios';
import { config } from '../../config/index.js';
import { logger } from '../../core/utils/logger.js';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export class BinanceClient {
    axiosInstance;
    constructor() {
        this.axiosInstance = axios.create({
            baseURL: config.binance.baseUrl,
            headers: {
                'X-MBX-APIKEY': config.binance.apiKey
            },
            timeout: 30000
        });
    }
    async requestWithRetry(fn, label) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                return await fn();
            }
            catch (err) {
                const status = err.response?.status;
                const msg = err.response?.data?.msg || err.message;
                const isDeadSymbol = status === 400 && msg?.toLowerCase().includes('delivering');
                if (!isDeadSymbol) {
                    logger.warn(`[${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${msg} (status: ${status || 'N/A'})`);
                }
                if (status === 400 || status === 404 || isDeadSymbol) {
                    throw err;
                }
                if (attempt < MAX_RETRIES) {
                    const delay = RETRY_DELAY_MS * attempt;
                    if (!isDeadSymbol)
                        logger.info(`[${label}] retrying in ${delay}ms...`);
                    await sleep(delay);
                }
                else {
                    throw err;
                }
            }
        }
        throw new Error('Unreachable');
    }
    async getExchangeInfo() {
        return this.requestWithRetry(async () => {
            const resp = await this.axiosInstance.get('/fapi/v1/exchangeInfo');
            return resp.data;
        }, 'getExchangeInfo');
    }
    async get24hTicker() {
        return this.requestWithRetry(async () => {
            const resp = await this.axiosInstance.get('/fapi/v1/ticker/24hr');
            return resp.data;
        }, 'get24hTicker');
    }
    async getKlines(symbol, interval, limit = 500) {
        try {
            return await this.requestWithRetry(async () => {
                const resp = await this.axiosInstance.get('/fapi/v1/klines', {
                    params: { symbol, interval, limit }
                });
                return resp.data.map((k) => ({
                    timestamp: k[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),
                    quoteVolume: parseFloat(k[7])
                }));
            }, `getKlines(${symbol}/${interval})`);
        }
        catch (err) {
            if (err.response?.status !== 400) {
                logger.error(`Failed to get klines for ${symbol} on ${interval} after ${MAX_RETRIES} retries`, { error: err.message });
            }
            return [];
        }
    }
    async getFundingRate(symbol) {
        try {
            return await this.requestWithRetry(async () => {
                const resp = await this.axiosInstance.get('/fapi/v1/premiumIndex', {
                    params: { symbol }
                });
                return {
                    rate: parseFloat(resp.data.lastFundingRate),
                    nextFundingTime: resp.data.nextFundingTime
                };
            }, `getFundingRate(${symbol})`);
        }
        catch (err) {
            if (err.response?.status !== 400)
                logger.error(`Failed to get funding rate for ${symbol}`, { error: err.message });
            return null;
        }
    }
    async getOpenInterest(symbol) {
        try {
            return await this.requestWithRetry(async () => {
                const resp = await this.axiosInstance.get('/fapi/v1/openInterest', {
                    params: { symbol }
                });
                return parseFloat(resp.data.openInterest);
            }, `getOpenInterest(${symbol})`);
        }
        catch (err) {
            if (err.response?.status !== 400)
                logger.error(`Failed to get open interest for ${symbol}`, { error: err.message });
            return null;
        }
    }
    async getOpenInterestHist(symbol, period, limit = 30) {
        try {
            return await this.requestWithRetry(async () => {
                const resp = await this.axiosInstance.get('/futures/data/openInterestHist', {
                    params: { symbol, period, limit }
                });
                return resp.data.map((d) => parseFloat(d.sumOpenInterestValue));
            }, `getOpenInterestHist(${symbol}/${period})`);
        }
        catch (err) {
            if (err.response?.status !== 400)
                logger.error(`Failed to get open interest hist for ${symbol}`, { error: err.message });
            return [];
        }
    }
}
export const binanceClient = new BinanceClient();
//# sourceMappingURL=binance-client.js.map